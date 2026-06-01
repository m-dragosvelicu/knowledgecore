import { NextResponse } from "next/server";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { getTranscriber } from "@/lib/services";
import {
  assertGuestLlmBudget,
  GuestRateLimitError,
} from "@/lib/journey/guestRateLimit";

/**
 * L1 Slice 3 — speech-to-text route.
 *
 * Contract: receive a recorded-audio Blob (multipart form field `audio`),
 * transcribe it via the Gemini-audio provider (or the mock, per the LIVE_STT
 * opt-out in the service registry), and return the transcript as JSON. The audio
 * is NEVER persisted: it lives only as an in-request Uint8Array passed to the
 * transcriber and is then out of scope. The only durable trace is the LlmCall
 * telemetry row written by the live transcriber.
 *
 * The client puts the returned transcript into the SAME editable text field the
 * learner is typing in (not a black-box voice mode), so transcription errors can
 * be corrected before a graded answer is submitted.
 *
 * English-first; an optional `languageHint` form field is forwarded so the same
 * route handles other languages later by passing a different hint.
 */

// Node runtime: the transcriber writes a Prisma telemetry row and Buffer-encodes
// the audio, neither of which belongs on the Edge runtime.
export const runtime = "nodejs";

// Defensive size cap. Learner answers are short; this keeps a runaway upload from
// hitting the provider. Well under Gemini's inline-audio limit.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request): Promise<Response> {
  // Authenticated learners only (mirrors the rest of the app). Anonymous guests
  // count here too: the MicButton is reachable on the outcome and probe
  // pre-journey steps, so a guest session is valid but must obey the D2 budget.
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // D2 — a guest's transcription is a real Gemini call, so gate it against the
  // same rolling-window guest LLM budget the pre-journey actions use. No-op for
  // real (non-anonymous) accounts. Refuse over-budget with the same graceful
  // message the wizard shows, as a 429.
  try {
    await assertGuestLlmBudget(isAnonymousSession(session));
  } catch (err) {
    if (err instanceof GuestRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data with an `audio` field" },
      { status: 400 },
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json(
      { error: "missing `audio` blob" },
      { status: 400 },
    );
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: "empty recording" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "recording too large" },
      { status: 413 },
    );
  }

  // Browser MediaRecorder Blobs carry their own MIME type (e.g. "audio/webm").
  // Fall back to the form-provided hint, then a safe default.
  const mimeType =
    audio.type ||
    (typeof form.get("mimeType") === "string"
      ? (form.get("mimeType") as string)
      : "") ||
    "audio/webm";

  const languageHintRaw = form.get("languageHint");
  const languageHint =
    typeof languageHintRaw === "string" && languageHintRaw.trim().length > 0
      ? languageHintRaw.trim()
      : undefined;

  // Read the bytes ONCE into memory. They are never written to disk or the DB.
  const bytes = new Uint8Array(await audio.arrayBuffer());

  try {
    const { transcript } = await getTranscriber().transcribe({
      audio: bytes,
      mimeType,
      languageHint,
    });
    return NextResponse.json({ transcript });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[transcribe] failed: ${(err as Error).message}`,
    );
    return NextResponse.json(
      { error: "transcription failed" },
      { status: 502 },
    );
  }
}
