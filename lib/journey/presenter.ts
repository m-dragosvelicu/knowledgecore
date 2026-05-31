/**
 * Presenter-strategy seam (L1 architectural foundation, CHARTER B.4/B.7).
 *
 * WHAT THIS IS
 * ------------
 * The presenter is the single point at which a goalpost step's RENDER is adapted
 * to the learner. It does NOT change WHAT content a step contains (that is the
 * Path Outliner / Information Generator's job); it adapts HOW that content is
 * presented — pacing, how much support framing to show, and (later, placeholder
 * only) modality emphasis.
 *
 * A strategy takes a `(step, learnerProfile)` pair and returns RENDER DIRECTIVES.
 * The page reads those directives and applies them at the render boundary. The
 * default strategy is a pure pass-through: it returns identity directives, so
 * with only the default registered the learner sees EXACTLY what they see today.
 *
 * WHY A SEAM NOW
 * --------------
 * L1 needs a clean, swappable place to plug in adaptation (pace/support) without
 * touching every render site. This file is that seam. Strategies are looked up
 * through `getPresenter()`, mirroring the `getServices()` registry pattern in
 * `lib/services/index.ts`, so an alternate strategy can be registered later
 * behind a flag without changing call sites.
 *
 * BOUNDARY NOTES
 * --------------
 * - The seam is intentionally decoupled from Prisma's full `Step` model. It
 *   consumes a minimal `PresenterStep` shape so the directive logic never
 *   depends on persistence details.
 * - `LearnerProfile` is a MINIMAL, forward-looking type. Its real
 *   persistence/schema is owned by the Backend Engineer and designed separately;
 *   the seam treats the profile as optional and the default strategy ignores it.
 *   The seam MUST accept a null/empty/undefined profile gracefully.
 * - `modalityWeight` is a PLACEHOLDER field only. It is included, defaulted to a
 *   neutral value, and NO modality behavior is implemented here. The design is
 *   being reframed so that visuals are content-driven, not a learner trait, so
 *   nothing should branch on this field yet.
 */

import type { StepType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The minimal slice of a goalpost step the presenter needs. Decoupled from the
 * Prisma `Step` model on purpose — the directive computation only depends on the
 * step's kind, not on its persisted payload/ids. Widen this shape only when a
 * strategy genuinely needs more, and keep additions optional.
 */
export interface PresenterStep {
  /** Discriminates information vs. the experience variants (StepType from Prisma). */
  type: StepType;
}

/**
 * Minimal, forward-looking learner profile the seam consumes.
 *
 * Every field is optional and the seam accepts `null`/`undefined`/`{}` without
 * throwing. The authoritative persistence shape is being designed by the Backend
 * Engineer; this interface only declares the fields a strategy may eventually
 * read. The default strategy reads NONE of them.
 */
export interface LearnerProfile {
  /**
   * The learner's self-reported motivation, when known. Mirrors the existing
   * `Motivation` enum captured by the intent flow (curiosity / fun / school /
   * work / other). Kept as an optional string here so the seam does not couple
   * to the Prisma enum import surface; a future strategy may narrow it.
   */
  motivation?: string;
  /**
   * Optional, coarse self-reported pace preference. Reserved for a future
   * pace-adapting strategy; the default ignores it.
   */
  pacePreference?: "slower" | "default" | "faster";
}

/** A profile may legitimately be absent (e.g. anonymous / not-yet-built). */
export type MaybeLearnerProfile = LearnerProfile | null | undefined;

// ---------------------------------------------------------------------------
// Outputs (render directives)
// ---------------------------------------------------------------------------

/**
 * How much supporting framing/scaffolding to surface around a step.
 *
 * NOTE the knob is named `supportLevel` (the CEO renamed it from "scaffolding").
 * `standard` is the neutral identity value — equivalent to today's behavior.
 */
export type SupportLevel = "minimal" | "standard" | "extended";

/**
 * PLACEHOLDER modality emphasis. Included for forward compatibility ONLY.
 * No code should branch on this yet — visuals are being reframed as
 * content-driven, not a learner trait. `neutral` is the only value the seam
 * emits today.
 */
export type ModalityWeight = "neutral";

/**
 * The render directives a strategy returns. The render boundary applies these;
 * it does not interpret learner state itself.
 */
export interface RenderDirectives {
  /**
   * Multiplies time-based render values (e.g. the information dwell gate).
   * `1` is identity — no change from today. Must be finite and > 0.
   */
  paceMultiplier: number;
  /** How much supporting framing to surface. `standard` is identity. */
  supportLevel: SupportLevel;
  /** PLACEHOLDER — always `neutral` today; no behavior attached. */
  modalityWeight: ModalityWeight;
}

/**
 * The identity directives. Returning these is guaranteed to change NOTHING the
 * learner sees relative to current behavior.
 */
export const IDENTITY_DIRECTIVES: Readonly<RenderDirectives> = Object.freeze({
  paceMultiplier: 1,
  supportLevel: "standard",
  modalityWeight: "neutral",
});

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

/**
 * A presenter strategy maps `(step, learnerProfile)` to render directives.
 * Implementations MUST be pure and side-effect free, MUST tolerate a
 * null/empty profile, and MUST return finite, valid directives.
 */
export interface PresenterStrategy {
  /** Stable identifier for telemetry/selection (mirrors service mode strings). */
  readonly name: string;
  /** Compute the render directives for this step + (maybe-absent) profile. */
  directivesFor(step: PresenterStep, learnerProfile: MaybeLearnerProfile): RenderDirectives;
}

/**
 * The default, pass-through presenter. Ignores both the step kind and the
 * profile and always returns the identity directives. With only this strategy
 * registered, behavior is IDENTICAL to today.
 */
export const defaultPresenter: PresenterStrategy = {
  name: "default",
  directivesFor(_step: PresenterStep, _learnerProfile: MaybeLearnerProfile): RenderDirectives {
    // Return a fresh object (not the frozen singleton) so callers can safely
    // read it without risk of mutating shared state.
    return { ...IDENTITY_DIRECTIVES };
  },
};

// ---------------------------------------------------------------------------
// Registry / selector  (mirrors lib/services/index.ts getServices())
// ---------------------------------------------------------------------------

export type PresenterName = "default";

/**
 * Registry of available strategies. Only `default` is registered for now; alt
 * strategies get added here (and selected in `getPresenter()`) when L1
 * adaptation lands — call sites do not change.
 */
const REGISTRY: Record<PresenterName, PresenterStrategy> = {
  default: defaultPresenter,
};

/**
 * Returns the active presenter strategy. Mirrors `getServices()`: today it
 * always returns the default pass-through, so the rendered result is unchanged.
 * The selection point lives here so a future flag can swap strategies in one
 * place.
 */
export function getPresenter(): PresenterStrategy {
  return REGISTRY.default;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * Apply a pace multiplier to a base duration in seconds. Centralized so every
 * time-based render value uses identical rounding. With `paceMultiplier === 1`
 * this is the identity on whole-second inputs (e.g. 6 -> 6).
 *
 * Guards against a non-finite or non-positive multiplier by falling back to the
 * base seconds, so a malformed strategy can never produce a zero/NaN/negative
 * gate that would break the UI.
 */
export function applyPace(baseSeconds: number, paceMultiplier: number): number {
  if (!Number.isFinite(paceMultiplier) || paceMultiplier <= 0) return baseSeconds;
  return Math.round(baseSeconds * paceMultiplier);
}
