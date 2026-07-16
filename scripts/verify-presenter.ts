/**
 * Standalone check of the L1 presenter-strategy seam (lib/journey/presenter.ts).
 * Run: `bun run scripts/verify-presenter.ts`. No DB or LLM needed — presenter.ts
 * has only a type-level import of StepType. Exits non-zero on any failure.
 *
 * Proves defaultPresenter returns identity directives (pace 1, support
 * standard, modality neutral) across step types and profile states, that
 * getPresenter() resolves to it, and that applyPace guards malformed
 * multipliers while dwell(paceMultiplier=1) matches the current 6s.
 */
import {
  getPresenter,
  defaultPresenter,
  applyPace,
  IDENTITY_DIRECTIVES,
  type RenderDirectives,
  type PresenterStep,
  type MaybeLearnerProfile,
} from "../lib/journey/presenter";
import { StepType } from "@prisma/client";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

function isIdentity(d: RenderDirectives): boolean {
  return (
    d.paceMultiplier === 1 &&
    d.supportLevel === "standard" &&
    d.modalityWeight === "neutral"
  );
}

// ---- (a) defaultPresenter returns identity directives ------------------------
const steps: [string, PresenterStep][] = [
  ["information step", { type: StepType.information }],
  ["experience step", { type: StepType.experience_socratic }],
];
const profiles: [string, MaybeLearnerProfile][] = [
  ["null profile", null],
  ["undefined profile", undefined],
  [
    "empty profile",
    {
      conceptMastery: {},
      signals: {
        latestPaasEffort: null,
        totalRetries: 0,
        totalTimeOnTaskMs: 0,
        visualNotHelpfulCount: 0,
      },
      derivedSignals: null,
    },
  ],
  [
    "populated profile",
    {
      conceptMastery: { "concept-a": { mastery: 0.4, observations: 2, lastUpdatedAt: "2026-05-31T00:00:00.000Z" } },
      signals: {
        latestPaasEffort: 7,
        totalRetries: 1,
        totalTimeOnTaskMs: 120000,
        visualNotHelpfulCount: 0,
      },
      derivedSignals: { expertiseBand: "developing" },
    },
  ],
];

for (const [stepName, step] of steps) {
  for (const [profName, profile] of profiles) {
    const d = defaultPresenter.directivesFor(step, profile);
    check(
      `defaultPresenter identity | ${stepName} + ${profName}`,
      isIdentity(d),
      JSON.stringify(d),
    );
  }
}

// The exported IDENTITY_DIRECTIVES constant is itself identity (sanity).
check("IDENTITY_DIRECTIVES is identity", isIdentity(IDENTITY_DIRECTIVES));

// defaultPresenter returns a fresh object, not the frozen singleton.
const fresh = defaultPresenter.directivesFor({ type: StepType.information }, null);
check("defaultPresenter returns a mutable copy", fresh !== IDENTITY_DIRECTIVES);

// ---- (b) registry returns the default ----------------------------------------
const active = getPresenter();
check("getPresenter() returns defaultPresenter", active === defaultPresenter);
check('getPresenter().name === "default"', active.name === "default");

// ---- (c) dwell computation with paceMultiplier 1 equals current 6s -----------
const CURRENT_DWELL = 6;
const directives = getPresenter().directivesFor({ type: StepType.information }, null);
const dwell = applyPace(CURRENT_DWELL, directives.paceMultiplier);
check(
  "dwell with paceMultiplier 1 === current 6s",
  dwell === CURRENT_DWELL,
  `got=${dwell} want=${CURRENT_DWELL}`,
);

// applyPace guards: malformed multipliers fall back to base seconds.
check("applyPace(6, 0) falls back to 6", applyPace(6, 0) === 6);
check("applyPace(6, -1) falls back to 6", applyPace(6, -1) === 6);
check("applyPace(6, NaN) falls back to 6", applyPace(6, Number.NaN) === 6);
check("applyPace(6, Infinity) falls back to 6", applyPace(6, Number.POSITIVE_INFINITY) === 6);
// And a real (future) multiplier scales + rounds as expected.
check("applyPace(6, 1.5) === 9", applyPace(6, 1.5) === 9);

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
