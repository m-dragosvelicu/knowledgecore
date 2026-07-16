/**
 * L1 Learner Profile — domain types + the transparent mastery update rule.
 *
 * The journey-level learner profile (CEO/L1-learner-profile-representation.html)
 * has a per-concept mastery core (P(mastered) in [0,1]) plus a small typed
 * signal vector for things mastery doesn't capture (Paas effort, retries,
 * time-on-task, visual-not-helpful counter). This module is the PURE logic
 * only — domain types, the BKT-style update, evidence-folding helpers — no
 * Prisma/DB/LLM dependency, unit-tested via scripts/verify-learner-profile.ts.
 * Persistence (LearnerProfile + append-only LearnerProfileSnapshot rows) is
 * wired separately by the server actions.
 *
 * Honest framing: this is a BKT-*style* rule (Corbett & Anderson 1995) with
 * FIXED, documented parameters, not a fitted model — journeys are too short
 * and concepts too LLM-generated-per-journey for real per-skill calibration.
 * It's a principled, inspectable, monotone-ish signal, not a psychometric claim.
 */

/**
 * The four BKT parameters, fixed by hand — the ONLY knobs of the rule; not
 * learned from data.
 *  - `prior` 0.25: P(already mastered) before any evidence — conservative.
 *  - `learn` 0.15: P(unmastered -> mastered) per learning opportunity.
 *  - `slip` 0.10: P(mastered learner still answers incorrectly).
 *  - `guess` 0.20: P(unmastered learner still answers correctly).
 * Constraint: slip + guess < 1 (BKT identifiability bound), so a correct
 * answer is always more likely under mastery than non-mastery.
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
 * One BKT update step: given prior P(mastered) and binary evidence
 * (`correct`), returns the posterior after conditioning on the observation
 * (Bayes' rule via slip/guess) and applying the learning transition:
 *   if correct:   P(M|obs) = P(M)(1-slip) / [P(M)(1-slip) + (1-P(M))guess]
 *   if incorrect: P(M|obs) = P(M)slip     / [P(M)slip     + (1-P(M))(1-guess)]
 *   P(M_next) = P(M|obs) + (1 - P(M|obs)) * learn
 *
 * Total: a non-finite/out-of-range prior falls back to the fixed `prior`;
 * result is clamped to [0,1].
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
 * ConceptMasteryMap (input never mutated). A concept seen for the first time
 * starts from the fixed `prior`, so the first observation moves a sensible
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
 * Fold a "visual not helpful" event into the profile, returning a NEW state
 * (input never mutated). Bumps only the signal-vector counter — not mastery
 * evidence, never touches the mastery core.
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
 * Map a checkpoint decision onto BKT evidence: `advance` is "correct",
 * `repeat` is "incorrect". `adjust_plan` is NOT mastery evidence (it means
 * the plan targeted the wrong thing — Coverage Mismatch), so it yields
 * `null` and no mastery evidence is folded.
 */
export function decisionToMasteryEvidence(
  decision: "advance" | "repeat" | "adjust_plan",
): boolean | null {
  if (decision === "advance") return true;
  if (decision === "repeat") return false;
  return null; // adjust_plan: not evidence about the learner's mastery
}
