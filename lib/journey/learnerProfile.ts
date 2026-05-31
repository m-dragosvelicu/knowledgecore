/**
 * L1 Learner Profile — domain types + the transparent mastery update rule.
 *
 * WHAT THIS IS
 * ------------
 * The journey-level learner profile (CEO/L1-learner-profile-representation.html)
 * has two parts:
 *   1. a per-concept MASTERY CORE — one number per concept in [0,1], the
 *      estimated probability the learner has mastered that concept, and
 *   2. a small TYPED SIGNAL VECTOR for things mastery does not capture (latest
 *      Paas effort, retries, time-on-task, visual-not-helpful counter).
 *
 * This module owns the PURE logic: the domain types, the BKT-style mastery
 * update rule, and small helpers to fold evidence into a profile. It has NO
 * Prisma / DB / LLM dependency, so it is trivially unit-testable
 * (`scripts/verify-learner-profile.ts`). Persistence (the LearnerProfile and
 * append-only LearnerProfileSnapshot rows) is wired separately by the server
 * actions; this module never writes to the DB.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HONEST FRAMING — this is a BKT-*style* rule, NOT a fitted model.
 * ───────────────────────────────────────────────────────────────────────────
 * The update is the classic Bayesian Knowledge Tracing formulation of
 * Corbett & Anderson (1995), but with FIXED, CHOSEN, DOCUMENTED parameters
 * (prior, learn, slip, guess). Real BKT fits its parameters to large per-skill
 * datasets. We cannot: journeys are short (little per-learner data) and the
 * concepts are themselves LLM-generated per journey rather than drawn from a
 * fixed, pre-calibrated skill list. So this is a principled, inspectable,
 * monotone-ish mastery signal — NOT a calibrated psychometric claim. We state
 * that plainly; the honesty is itself defensible thesis content.
 */

// ---------------------------------------------------------------------------
// Fixed BKT parameters (transparent rule, not fitted — see file header)
// ---------------------------------------------------------------------------

/**
 * The four standard BKT parameters, fixed by hand and documented here. These are
 * the ONLY knobs of the rule; they are not learned from data.
 *
 *  - `prior` (P-init): probability a concept is already mastered before any
 *    evidence. 0.25 = "assume mostly-unknown but not impossible" — conservative,
 *    so early adaptation does not over-claim mastery on thin signal.
 *  - `learn` (P-transit): probability an unmastered concept transitions to
 *    mastered after one learning opportunity. 0.15 = steady but not instant
 *    learning, so mastery ramps rather than jumps.
 *  - `slip` (P-slip): probability a learner who HAS mastered the concept still
 *    answers incorrectly (a careless slip). 0.10.
 *  - `guess` (P-guess): probability a learner who has NOT mastered the concept
 *    still answers correctly (a lucky guess). 0.20.
 *
 * Constraint respected: slip + guess < 1 (the standard BKT identifiability
 * sanity bound), so a correct answer is genuinely more likely under mastery than
 * under non-mastery and the posterior moves in the intuitive direction.
 */
export interface BktParams {
  /** P-init: prior probability a concept is already mastered. */
  prior: number;
  /** P-transit: probability an unmastered concept becomes mastered per opportunity. */
  learn: number;
  /** P-slip: probability a mastered concept is still answered incorrectly. */
  slip: number;
  /** P-guess: probability an unmastered concept is still answered correctly. */
  guess: number;
}

export const BKT_PARAMS: Readonly<BktParams> = Object.freeze({
  prior: 0.25,
  learn: 0.15,
  slip: 0.1,
  guess: 0.2,
});

/** The neutral starting mastery for a concept with no evidence yet (= prior). */
export const INITIAL_MASTERY = BKT_PARAMS.prior;

// ---------------------------------------------------------------------------
// Domain types — the structured profile shape (shared source of truth)
// ---------------------------------------------------------------------------

/** Per-concept mastery state. `mastery` is P(mastered) in [0,1]. */
export interface ConceptMastery {
  /** Estimated probability the learner has mastered this concept, in [0,1]. */
  mastery: number;
  /** How many pieces of evidence have been folded into this estimate. */
  observations: number;
  /** ISO8601 timestamp of the last update. */
  lastUpdatedAt: string;
}

/** The mastery core: a map from a stable concept key to its mastery state. */
export type ConceptMasteryMap = Record<string, ConceptMastery>;

/**
 * The four typed signals the mastery core does not capture. Mirrors the Prisma
 * `LearnerProfile` columns exactly. The two cut onboarding micro-questions
 * (self-efficacy slider, plan-vs-problem) are deliberately ABSENT.
 */
export interface SignalVector {
  /** Latest Paas perceived-effort rating (1..9), or null before the first tap. */
  latestPaasEffort: number | null;
  /** Running count of repeat attempts across the journey. */
  totalRetries: number;
  /** Cumulative time-on-task in milliseconds. */
  totalTimeOnTaskMs: number;
  /** How often the learner flagged a visual as not helpful. */
  visualNotHelpfulCount: number;
}

/**
 * The evolving / inferred bag. Model-derived but still STRUCTURED (never a
 * freeform paragraph). Open shape so inferred fields can evolve without a
 * migration; the named fields below are the ones L1 expects to populate.
 */
export interface DerivedSignals {
  readingLevel?: string;
  expertiseBand?: "novice" | "developing" | "proficient";
  lastInferredAt?: string;
  [key: string]: unknown;
}

/**
 * The full structured profile as a plain object (independent of Prisma). This is
 * the shape the generation serializer and the presenter seam read. The persisted
 * row maps 1:1 onto it.
 */
export interface LearnerProfileState {
  conceptMastery: ConceptMasteryMap;
  signals: SignalVector;
  derivedSignals: DerivedSignals | null;
}

/** A fresh, empty profile state (used at journey/profile creation). */
export function emptyProfileState(): LearnerProfileState {
  return {
    conceptMastery: {},
    signals: {
      latestPaasEffort: null,
      totalRetries: 0,
      totalTimeOnTaskMs: 0,
      visualNotHelpfulCount: 0,
    },
    derivedSignals: null,
  };
}

// ---------------------------------------------------------------------------
// The BKT-style update rule (pure)
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * One step of the BKT update for a single concept.
 *
 * Given the PRIOR P(mastered) and one piece of binary evidence (`correct`),
 * returns the POSTERIOR P(mastered) after also accounting for one learning
 * opportunity. This is the textbook Corbett & Anderson (1995) update:
 *
 *   1. Condition on the observation (Bayes' rule), using slip/guess:
 *        if correct:   P(M|obs) = P(M)(1-slip) / [P(M)(1-slip) + (1-P(M))guess]
 *        if incorrect: P(M|obs) = P(M)slip     / [P(M)slip     + (1-P(M))(1-guess)]
 *   2. Apply the learning transition (an unmastered concept may become mastered):
 *        P(M_next) = P(M|obs) + (1 - P(M|obs)) * learn
 *
 * Pure and total: any non-finite or out-of-range prior is treated as the fixed
 * `prior`, and the result is clamped to [0,1]. With the fixed params, a correct
 * answer always raises the estimate and an incorrect answer always lowers the
 * conditioned term — i.e. the rule is monotone in the intuitive direction.
 */
export function bktUpdate(
  priorMastery: number,
  correct: boolean,
  params: BktParams = BKT_PARAMS,
): number {
  const pM =
    Number.isFinite(priorMastery) && priorMastery >= 0 && priorMastery <= 1
      ? priorMastery
      : params.prior;
  const pNotM = 1 - pM;

  // Step 1 — Bayesian conditioning on the observation.
  let conditioned: number;
  if (correct) {
    const num = pM * (1 - params.slip);
    const den = num + pNotM * params.guess;
    conditioned = den > 0 ? num / den : pM;
  } else {
    const num = pM * params.slip;
    const den = num + pNotM * (1 - params.guess);
    conditioned = den > 0 ? num / den : pM;
  }

  // Step 2 — learning transition.
  const posterior = conditioned + (1 - conditioned) * params.learn;
  return clamp01(posterior);
}

// ---------------------------------------------------------------------------
// Folding evidence into the mastery core (pure, immutable)
// ---------------------------------------------------------------------------

/**
 * Apply one piece of mastery evidence for a concept, returning a NEW
 * ConceptMasteryMap (the input is never mutated — callers persist the result and
 * write an immutable snapshot of it).
 *
 * A concept seen for the first time starts from the fixed `prior` before the
 * update is applied, so the very first observation already moves a sensible
 * starting point rather than 0.
 */
export function applyMasteryEvidence(
  map: ConceptMasteryMap,
  conceptKey: string,
  correct: boolean,
  at: Date = new Date(),
  params: BktParams = BKT_PARAMS,
): ConceptMasteryMap {
  const existing = map[conceptKey];
  const priorMastery = existing ? existing.mastery : params.prior;
  const observations = (existing ? existing.observations : 0) + 1;
  const mastery = bktUpdate(priorMastery, correct, params);

  return {
    ...map,
    [conceptKey]: {
      mastery,
      observations,
      lastUpdatedAt: at.toISOString(),
    },
  };
}

/**
 * L1 Slice 4 — fold a "visual not helpful" event into the profile, returning a
 * NEW state (the input is never mutated). It bumps ONLY the signal-vector
 * counter; it is NOT mastery evidence and never touches the mastery core. Pure so
 * the store (recordVisualNotHelpful) stays thin and the increment is unit-testable
 * without a DB.
 */
export function incrementVisualNotHelpful(
  state: LearnerProfileState,
): LearnerProfileState {
  return {
    ...state,
    signals: {
      ...state.signals,
      visualNotHelpfulCount: state.signals.visualNotHelpfulCount + 1,
    },
  };
}

/**
 * Map a checkpoint decision onto BKT evidence. `advance` is "correct";
 * `repeat` is "incorrect". `adjust_plan` is NOT mastery evidence about the
 * learner (it means the PLAN targeted the wrong thing — Coverage Mismatch), so
 * it yields `null` and the caller folds no mastery evidence for it.
 */
export function decisionToMasteryEvidence(
  decision: "advance" | "repeat" | "adjust_plan",
): boolean | null {
  if (decision === "advance") return true;
  if (decision === "repeat") return false;
  return null; // adjust_plan: not evidence about the learner's mastery
}
