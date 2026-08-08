import { NextResponse } from "next/server";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { getTranscriber } from "@/lib/services";
import {
  assertGuestLlmBudget,
  GuestRateLimitError,
} from "@/lib/llm/guestRateLimit";
import { withLlmTelemetryContext } from "@/lib/llm";

/**
 * L1 Slice 3 speech-to-text route. Takes a recorded-audio Blob (`audio` form
 * field), transcribes via the Gemini-audio provider (or mock, per LIVE_STT),
 * returns the transcript as JSON. Audio is never persisted — it's an
 * in-request Uint8Array only; the durable trace is the LlmCall telemetry row.
 * The client puts the transcript into the same editable field the learner was
 * typing in, so errors can be corrected before submitting. English-first; an
 * optional `languageHint` field carries other languages later.
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

  // D2: a guest's transcription is a real Gemini call, so gate it against the
  // same rolling-window guest LLM budget the pre-journey actions use (no-op
  // for real accounts). Over-budget returns the wizard's message as a 429.
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
    // No journey id travels with this route (the mic is reachable on
    // pre-journey outcome/probe steps); intentId stays null, only userId is
    // attributed.
    const { transcript } = await withLlmTelemetryContext(
      { userId: session.user.id },
      () =>
        getTranscriber().transcribe({
          audio: bytes,
          mimeType,
          languageHint,
        }),
    );
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
