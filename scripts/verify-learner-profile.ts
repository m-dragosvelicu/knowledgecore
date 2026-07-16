/**
 * Standalone check of the L1 learner-profile mastery rule
 * (lib/journey/learnerProfile.ts). Run: `bun run scripts/verify-learner-profile.ts`.
 * No DB or LLM needed — learnerProfile.ts is pure. Exits non-zero on any failure.
 *
 * Covers the BKT update rule: direction + clamping to [0,1], convergence over
 * repeated evidence, applyMasteryEvidence's immutability/observation-count/
 * timestamp behavior, decision->evidence mapping, and the slip+guess<1
 * identifiability bound on the fixed parameters.
 */
import {
  BKT_PARAMS,
  INITIAL_MASTERY,
  bktUpdate,
  applyMasteryEvidence,
  decisionToMasteryEvidence,
  emptyProfileState,
  type ConceptMasteryMap,
} from "../lib/journey/learnerProfile";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

// ---- (e) parameter sanity -----------------------------------------------------
check(
  "BKT identifiability bound: slip + guess < 1",
  BKT_PARAMS.slip + BKT_PARAMS.guess < 1,
  `slip=${BKT_PARAMS.slip} guess=${BKT_PARAMS.guess}`,
);
check("INITIAL_MASTERY === prior", INITIAL_MASTERY === BKT_PARAMS.prior, `=${INITIAL_MASTERY}`);

// ---- (a) single-step direction + clamping ------------------------------------
const upFromPrior = bktUpdate(BKT_PARAMS.prior, true);
const downFromPrior = bktUpdate(BKT_PARAMS.prior, false);
check("correct answer raises mastery above prior", upFromPrior > BKT_PARAMS.prior, `${upFromPrior}`);
check(
  "incorrect answer: posterior <= a correct answer's posterior",
  downFromPrior < upFromPrior,
  `incorrect=${downFromPrior} correct=${upFromPrior}`,
);
check("result stays in [0,1] (correct)", upFromPrior >= 0 && upFromPrior <= 1);
check("result stays in [0,1] (incorrect)", downFromPrior >= 0 && downFromPrior <= 1);

// malformed prior falls back to the fixed prior, then updates from there.
check(
  "malformed prior (NaN) falls back to fixed prior",
  bktUpdate(Number.NaN, true) === bktUpdate(BKT_PARAMS.prior, true),
);
check(
  "out-of-range prior (1.5) falls back to fixed prior",
  bktUpdate(1.5, true) === bktUpdate(BKT_PARAMS.prior, true),
);
check("determinism: same inputs -> same output", bktUpdate(0.4, true) === bktUpdate(0.4, true));

// ---- (b) convergence over repeated evidence ----------------------------------
let m = BKT_PARAMS.prior;
const seq: number[] = [m];
for (let i = 0; i < 8; i++) {
  m = bktUpdate(m, true);
  seq.push(m);
}
const strictlyIncreasing = seq.every((v, i) => i === 0 || v > seq[i - 1]);
check("8 correct answers strictly increase mastery", strictlyIncreasing, seq.map((v) => v.toFixed(3)).join(" -> "));
check("converges high after 8 correct (>0.95)", m > 0.95, `${m.toFixed(4)}`);
check("never exceeds 1", m <= 1);

let mlow = BKT_PARAMS.prior;
for (let i = 0; i < 8; i++) mlow = bktUpdate(mlow, false);
check("8 incorrect answers keep mastery low (<0.25)", mlow < 0.25, `${mlow.toFixed(4)}`);

// ---- (c) applyMasteryEvidence: immutable, prior-seeded, observation count -----
const t0 = new Date("2026-05-31T12:00:00.000Z");
const empty: ConceptMasteryMap = {};
const afterFirst = applyMasteryEvidence(empty, "ratios", true, t0);
check("applyMasteryEvidence does not mutate input", Object.keys(empty).length === 0);
check("new concept gets observations=1", afterFirst["ratios"].observations === 1);
check(
  "new concept starts from prior then updates (== bktUpdate(prior,true))",
  afterFirst["ratios"].mastery === bktUpdate(BKT_PARAMS.prior, true),
);
check("lastUpdatedAt stamped from `at`", afterFirst["ratios"].lastUpdatedAt === t0.toISOString());

const t1 = new Date("2026-05-31T12:05:00.000Z");
const afterSecond = applyMasteryEvidence(afterFirst, "ratios", true, t1);
check("second observation increments to 2", afterSecond["ratios"].observations === 2);
check("second correct raises mastery further", afterSecond["ratios"].mastery > afterFirst["ratios"].mastery);
check("unrelated concept untouched across updates", afterSecond["ratios"] !== afterFirst["ratios"]);

// ---- (d) decision -> evidence mapping ----------------------------------------
check("advance -> correct (true)", decisionToMasteryEvidence("advance") === true);
check("repeat -> incorrect (false)", decisionToMasteryEvidence("repeat") === false);
check("adjust_plan -> null (not mastery evidence)", decisionToMasteryEvidence("adjust_plan") === null);

// ---- empty profile state shape -----------------------------------------------
const fresh = emptyProfileState();
check(
  "emptyProfileState: empty mastery + zeroed signals + null derived",
  Object.keys(fresh.conceptMastery).length === 0 &&
    fresh.signals.latestPaasEffort === null &&
    fresh.signals.totalRetries === 0 &&
    fresh.signals.totalTimeOnTaskMs === 0 &&
    fresh.signals.visualNotHelpfulCount === 0 &&
    fresh.derivedSignals === null,
);

console.log(`\nBKT_PARAMS = ${JSON.stringify(BKT_PARAMS)}`);
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
