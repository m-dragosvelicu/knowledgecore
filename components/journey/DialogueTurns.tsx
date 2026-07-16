"use client";

import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import type { InterviewTurn } from "@/lib/services/types";

// Shared presentation for the turn-taking dialogue surfaces (the Goal Interview,
// the Path Confirmation clarifying dialogue, and any future Socratic remediation
// turn). It renders the conversation as chat bubbles: the guide's questions on
// the left, the learner's answers on the right, every turn at the same scale.
//
// Single source of truth for the ACTIVE question: the running transcript always
// ends with the active assistant question (the client appends it before
// re-rendering), so exactly one surface may draw it. Two modes:
//   - default: the thread draws the whole transcript, active question included,
//     as the newest guide bubble. Pure chat (the Goal Interview's back-and-forth).
//   - dropActiveQuestion: the caller hoists the active question into a heading of
//     its own, so the trailing assistant turn is skipped here (the Path
//     Confirmation gate).
//
// Presentation only -- it never changes the turn-taking logic or what is asked.

type Props = {
  transcript: InterviewTurn[];
  /**
   * Omit the trailing active question from the thread. Only for callers that
   * render that question themselves; a pure-chat caller must leave this off or
   * the newest guide message disappears.
   */
  dropActiveQuestion?: boolean;
};

// The active question is the assistant turn at the very end of the transcript;
// everything before it is the back-and-forth so far. Exported because callers
// switch presentation on whether that back-and-forth exists yet.
export function priorTurns(transcript: InterviewTurn[]): InterviewTurn[] {
  if (
    transcript.length > 0 &&
    transcript[transcript.length - 1].role === "assistant"
  ) {
    return transcript.slice(0, -1);
  }
  return transcript;
}

export default function DialogueTurns({
  transcript,
  dropActiveQuestion = false,
}: Props) {
  const turns = dropActiveQuestion ? priorTurns(transcript) : transcript;
  if (turns.length === 0) return null;

  return (
    <Stack spacing={1.5}>
      {turns.map((t, i) => {
        const isAsk = t.role === "assistant";
        return (
          <Box
            key={i}
            sx={{
              alignSelf: isAsk ? "flex-start" : "flex-end",
              maxWidth: "86%",
              bgcolor: isAsk ? "background.paper" : "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              boxShadow: isAsk ? "var(--shadow-sm)" : "none",
              p: "14px 18px",
            }}
          >
            <Box className="kc-meta" sx={{ mb: "6px" }}>
              {isAsk ? "Your guide" : "You"}
            </Box>
            <Box
              sx={
                isAsk
                  ? {
                      fontFamily: "var(--font-display)",
                      fontVariationSettings: "var(--soft-ui)",
                      fontWeight: 500,
                      fontSize: 17,
                      lineHeight: 1.35,
                      color: "var(--ink)",
                    }
                  : {
                      fontSize: 15.5,
                      lineHeight: 1.5,
                      color: "var(--ink)",
                    }
              }
            >
              {t.content}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
