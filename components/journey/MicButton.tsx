"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";

/**
 * Shared mic button used across the product. Records audio, posts to
 * /api/transcribe, and hands the transcript back via `onTranscript` — it does
 * not own a text field. The parent must drop the transcript into the same
 * editable field the learner types in, so the learner can fix transcription
 * errors before a graded answer submits.
 */

type RecordingState = "idle" | "recording" | "transcribing";

type Props = {
  /** Called with the clean transcript when transcription completes. */
  onTranscript: (text: string) => void;
  /** Disable the mic (e.g. while the surrounding form is submitting). */
  disabled?: boolean;
  /** Optional language hint forwarded to the route (English-first default). */
  languageHint?: string;
  size?: "small" | "medium";
};

// Ordered by Gemini-friendliness.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

export default function MicButton({
  onTranscript,
  disabled = false,
  languageHint,
  size = "small",
}: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Feature-detect on mount (avoids SSR mismatch — these APIs are client-only).
  useEffect(() => {
    const ok =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";
    setSupported(ok);
  }, []);

  // Always release the mic stream when unmounting mid-recording.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const sendForTranscription = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        // The Blob's own type is the source of truth for the server.
        form.append("audio", blob, "recording");
        if (languageHint) form.append("languageHint", languageHint);
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          throw new Error(`transcription request failed (${res.status})`);
        }
        const data = (await res.json()) as { transcript?: string };
        const transcript = (data.transcript ?? "").trim();
        if (transcript.length > 0) {
          onTranscript(transcript);
        } else {
          setError("Didn't catch that — try again.");
        }
      } catch {
        setError("Couldn't transcribe — you can type instead.");
      } finally {
        setState("idle");
      }
    },
    [languageHint, onTranscript],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size > 0) void sendForTranscription(blob);
        else setState("idle");
      };
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
    } catch {
      stopStream();
      setState("idle");
      setError("Microphone access was blocked.");
    }
  }, [sendForTranscription, stopStream]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // fires onstop -> sends for transcription
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === "recording") stopRecording();
    else if (state === "idle") void startRecording();
  }, [state, startRecording, stopRecording]);

  if (!supported) {
    // No MediaRecorder (e.g. older Safari/Firefox): hide the mic entirely so the
    // text field is still fully usable by typing. No broken affordance.
    return null;
  }

  const label =
    state === "recording"
      ? "Stop recording"
      : state === "transcribing"
        ? "Transcribing…"
        : "Record your answer by voice";

  return (
    <Box
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
    >
      <Tooltip title={label} arrow>
        {/* span wrapper so the tooltip still shows when the button is disabled */}
        <span>
          <IconButton
            type="button"
            size={size}
            onClick={toggle}
            disabled={disabled || state === "transcribing"}
            aria-label={label}
            aria-pressed={state === "recording"}
            color={state === "recording" ? "error" : "default"}
            sx={{
              color:
                state === "recording" ? "error.main" : "text.secondary",
              "@keyframes micPulse": {
                "0%": { opacity: 1 },
                "50%": { opacity: 0.35 },
                "100%": { opacity: 1 },
              },
              animation:
                state === "recording" ? "micPulse 1.2s ease-in-out infinite" : "none",
            }}
          >
            {state === "transcribing" ? (
              <CircularProgress size={18} thickness={5} />
            ) : (
              // Inline mic glyph keeps us offline-safe with no icon dependency.
              <Box
                component="svg"
                viewBox="0 0 24 24"
                width={18}
                height={18}
                sx={{ fill: "none", stroke: "currentColor", strokeWidth: 2 }}
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </Box>
            )}
          </IconButton>
        </span>
      </Tooltip>
      {/* Status text for screen readers + a quiet visual error hint. */}
      <Box
        component="span"
        aria-live="polite"
        sx={{
          fontSize: "0.75rem",
          color: error ? "error.main" : "text.secondary",
          maxWidth: 220,
        }}
      >
        {state === "recording"
          ? "Recording… tap to stop"
          : error ?? ""}
      </Box>
    </Box>
  );
}
