/**
 * Presenter seam (CHARTER B.4/B.7): adapts HOW a goalpost step renders
 * (pacing, support, framing) — never WHAT it contains. A strategy maps
 * (step, learnerProfile) -> render directives; the default is an identity
 * pass-through. Strategies are looked up via getPresenter(), mirroring the
 * getServices() registry, so alternates can ship behind a flag without
 * touching call sites. The profile is optional and may be null/undefined.
 * `modalityWeight` is a placeholder — nothing should branch on it yet.
 */

import type { StepType } from "@prisma/client";
import type { LearnerProfileState } from "./model";

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
 * The learner profile the seam consumes: the real persisted
 * `LearnerProfileState` (lib/journey/profile/model.ts), imported as a plain
 * domain type so the seam stays decoupled from the Prisma client model.
 *
 * Every strategy must tolerate a null/undefined profile and an empty mastery
 * map. Per the Slice 1 rescope, this seam is render-only (pace/dwell) —
 * substance adaptation (depth, worked-example count) happens at generation
 * time with the profile injected, not here.
 */
export type LearnerProfile = LearnerProfileState;

/** A profile may legitimately be absent (e.g. anonymous / not-yet-built). */
export type MaybeLearnerProfile = LearnerProfile | null | undefined;

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

/**
 * Apply a pace multiplier to a base duration in seconds; identity at
 * `paceMultiplier === 1`. Falls back to the base seconds on a non-finite or
 * non-positive multiplier, so a malformed strategy can't produce a
 * zero/NaN/negative gate.
 */
export function applyPace(baseSeconds: number, paceMultiplier: number): number {
  if (!Number.isFinite(paceMultiplier) || paceMultiplier <= 0) return baseSeconds;
  return Math.round(baseSeconds * paceMultiplier);
}
