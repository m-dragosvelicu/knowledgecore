import { prisma } from "@/lib/db";
import type { LlmCallPurpose } from "@prisma/client";

// ---------------------------------------------------------------------------
// D2 — anonymous LLM rate limit.
//
// Try-before-signup gives guests LIVE LLM responses (the real experience is the
// whole point), but caps abuse by reading the existing LlmCall purpose/cost log.
// We count the pre-journey-relevant LLM calls written in a rolling window and
// refuse further guest progress once the cap is hit. Real (signed-in) accounts
// are never rate-limited here.
//
// The cap is deliberately generous enough for one honest run-through (each
// pre-journey stage is a small number of calls) but low enough that a bot
// hammering the wizard is stopped quickly. We count GLOBAL guest-attributable
// pre-journey calls in the window rather than per-guest, because a guest can
// freely mint new guest ids by clearing cookies; a window-scoped global cap on
// the *cost-bearing* purposes is the honest abuse brake. Per-guest tightening
// could be layered later by joining LlmCall to the owning intent's userId.
// ---------------------------------------------------------------------------

// The cost-bearing LLM purposes a guest can drive from the pre-journey flow.
const GUEST_PURPOSES: LlmCallPurpose[] = [
  "intent_parse",
  "goal_interview",
  "knowledge_probe_questions",
  "knowledge_probe_score",
  "path_outline",
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
