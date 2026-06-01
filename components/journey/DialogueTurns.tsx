"use client";

import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import type { InterviewTurn } from "@/lib/services/types";

// Shared presentation for the turn-taking dialogue surfaces (the Goal Interview,
// the Path Confirmation clarifying dialogue, and any future Socratic remediation
// turn). It renders the PRIOR turns of the conversation as a compact transcript:
// the guide's earlier questions and the learner's earlier answers.
//
// Single source of truth for the ACTIVE question: the current/active question is
// NEVER drawn here. It is owned solely by the input card's Fraunces heading. The
// running transcript always ends with the active assistant question (the client
// appends it before re-rendering), so this component drops that trailing
// assistant turn to avoid rendering the live question both as a transcript bubble
// and as the input-card heading. Earlier turns still render above as history.
//
// Presentation only -- it never changes the turn-taking logic or what is asked.

type Props = {
  transcript: InterviewTurn[];
};

// Given the full running transcript, return only the turns that belong ABOVE the
// active input card: everything except the trailing active question. The active
// question is the last assistant turn at the end of the transcript; the client
// shows it as the input-card heading, so we exclude it here.
export function priorTurns(transcript: InterviewTurn[]): InterviewTurn[] {
  if (
    transcript.length > 0 &&
    transcript[transcript.length - 1].role === "assistant"
  ) {
    return transcript.slice(0, -1);
  }
  return transcript;
}

export default function DialogueTurns({ transcript }: Props) {
  const prior = priorTurns(transcript);
  if (prior.length === 0) return null;

  return (
    <Stack spacing={1.5}>
      {prior.map((t, i) => {
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
