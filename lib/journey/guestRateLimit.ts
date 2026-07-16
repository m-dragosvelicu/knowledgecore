import { prisma } from "@/lib/db";
import type { LlmCallPurpose } from "@prisma/client";

// D2 — anonymous LLM rate limit. Guests get LIVE LLM responses (try-before-
// signup is the point), capped by counting the existing LlmCall log in a
// rolling window; real (signed-in) accounts are never rate-limited here.
// Counted GLOBALLY rather than per-guest, since a guest can mint new guest
// ids by clearing cookies — a window-scoped global cap on the cost-bearing
// purposes is the honest abuse brake. Per-guest tightening could be layered
// later by joining LlmCall to the owning intent's userId.

// The cost-bearing LLM purposes a guest can drive from the pre-journey flow.
// stt_transcribe is included because the MicButton (outcome/probe steps) is
// guest-reachable and each press is a real Gemini-audio call, so it must
// count against the same D2 budget; /api/transcribe enforces the cap.
const GUEST_PURPOSES: LlmCallPurpose[] = [
  "intent_parse",
  "goal_interview",
  "knowledge_probe_questions",
  "knowledge_probe_score",
  "path_outline",
  "stt_transcribe",
];

// Rolling window + cap. ~one honest run-through is a handful of intent parses, a
// short goal interview, probe question + score, and one path outline — comfortably
// under this. Tune via env without a code change.
const WINDOW_MS = Number(process.env.GUEST_LLM_WINDOW_MS ?? 60 * 60 * 1000); // 1h
const MAX_CALLS = Number(process.env.GUEST_LLM_MAX_CALLS ?? 60);

export class GuestRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestRateLimitError";
  }
}

/**
 * Throw GuestRateLimitError if the guest pre-journey LLM budget for the current
 * window is already spent. Call BEFORE kicking off a guest-driven LLM stage.
 * No-op (returns immediately) for real accounts — pass isAnonymous=false.
 */
export async function assertGuestLlmBudget(isAnonymous: boolean): Promise<void> {
  if (!isAnonymous) return;
  const since = new Date(Date.now() - WINDOW_MS);
  const used = await prisma.llmCall.count({
    where: { purpose: { in: GUEST_PURPOSES }, createdAt: { gte: since } },
  });
  if (used >= MAX_CALLS) {
    throw new GuestRateLimitError(
      "The free preview is busy right now. Create an account to keep building your path, " +
        "or try again in a little while.",
    );
  }
}

// Exposed for the deterministic verify script.
export const GUEST_LLM_LIMIT = { WINDOW_MS, MAX_CALLS, GUEST_PURPOSES };
