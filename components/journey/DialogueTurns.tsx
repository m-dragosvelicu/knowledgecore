"use client";

import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import type { InterviewTurn } from "@/lib/services/types";

// Shared chat-bubble presentation for turn-taking dialogue (Goal Interview,
// Path Confirmation clarifying dialogue, future Socratic remediation).
// Invariant: the transcript always ends with the active assistant question;
// exactly one surface may render it. `dropActiveQuestion` lets a caller hoist
// that question into its own heading instead of the thread's last bubble.

type Props = {
  transcript: InterviewTurn[];
  /**
   * Omit the trailing active question from the thread. Only for callers that
   * render that question themselves; a pure-chat caller must leave this off or
   * the newest guide message disappears.
   */
  dropActiveQuestion?: boolean;
};

// Exported: callers branch on whether prior turns exist yet.
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
