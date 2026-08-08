/**
 * L1 Slice 1 — deterministic proof of the one visible adaptation.
 * Run: `bun run scripts/verify-adaptation.ts`. No DB or LLM needed —
 * lib/journey/profile/adaptation.ts is pure. Exits non-zero on any failure.
 *
 * Checks low- vs high-mastery support plans (worked examples, support level),
 * the serialized Call B prompt text, the conservative-early guard on thin
 * signal, the low-mastery floor, and end-to-end Call B generation.
 */
import {
  deriveSupportPlan,
  serializeProfileForGeneration,
  WORKED_EXAMPLES_LOW,
  WORKED_EXAMPLES_HIGH,
  THIN_SIGNAL_OBSERVATIONS,
} from "../lib/journey/profile/adaptation";
import type { LearnerProfileState } from "../lib/journey/profile/model";
import type {
  LessonContent,
  LessonContentInput,
} from "../lib/services/lessonContent";
import type { LessonContentGenerator } from "../lib/services/interfaces/lessonContentGenerator.interface";

// Local deterministic Call-B double. Mirrors the deleted MockLessonContentGenerator:
// emits one "### Worked example" section per plan.workedExamples so section (e)
// can assert low-mastery -> more worked examples without an LLM.
class FakeLessonContentGenerator implements LessonContentGenerator {
  async generate(input: LessonContentInput): Promise<LessonContent> {
    const plan = deriveSupportPlan(input.profile, input.conceptKey);
    const examples: string[] = [];
    for (let i = 1; i <= plan.workedExamples; i++) {
      examples.push(`### Worked example ${i}\nStep through a concrete instance.`);
    }
    return {
      content: examples.join("\n"),
      supportLevel: plan.supportLevel,
      workedExamples: plan.workedExamples,
      visuals: [],
    };
  }
}

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

const CONCEPT = "goalpost-abc";

function profileWith(mastery: number, observations: number): LearnerProfileState {
  return {
    conceptMastery: {
      [CONCEPT]: {
        mastery,
        observations,
        lastUpdatedAt: "2026-05-31T12:00:00.000Z",
      },
    },
    signals: {
      latestPaasEffort: null,
      totalRetries: 0,
      totalTimeOnTaskMs: 0,
      visualNotHelpfulCount: 0,
    },
    derivedSignals: null,
  };
}

// Well-evidenced (not thin) low- and high-mastery profiles.
const lowProfile = profileWith(0.15, 4);
const highProfile = profileWith(0.9, 4);

const lowPlan = deriveSupportPlan(lowProfile, CONCEPT);
const highPlan = deriveSupportPlan(highProfile, CONCEPT);

// ---- (a) the core adaptation: low gets MORE support than high ----------------
check(
  "low-mastery worked examples > high-mastery worked examples",
  lowPlan.workedExamples > highPlan.workedExamples,
  `low=${lowPlan.workedExamples} high=${highPlan.workedExamples}`,
);
check(
  "low-mastery supportLevel is 'extended'",
  lowPlan.supportLevel === "extended",
  lowPlan.supportLevel,
);
check(
  "high-mastery supportLevel is 'minimal'",
  highPlan.supportLevel === "minimal",
  highPlan.supportLevel,
);
check(
  "low worked examples == WORKED_EXAMPLES_LOW",
  lowPlan.workedExamples === WORKED_EXAMPLES_LOW,
  `${lowPlan.workedExamples}`,
);
check(
  "high worked examples == WORKED_EXAMPLES_HIGH",
  highPlan.workedExamples === WORKED_EXAMPLES_HIGH,
  `${highPlan.workedExamples}`,
);

// ---- (b) the serialized Call B prompt block reflects the difference ----------
const lowBlock = serializeProfileForGeneration(lowProfile, CONCEPT);
const highBlock = serializeProfileForGeneration(highProfile, CONCEPT);

check(
  "low block requests >= WORKED_EXAMPLES_LOW worked examples",
  lowBlock.includes(`AT LEAST ${WORKED_EXAMPLES_LOW} fully worked example`),
  "",
);
check(
  "high block requests WORKED_EXAMPLES_HIGH worked example",
  highBlock.includes(`AT LEAST ${WORKED_EXAMPLES_HIGH} fully worked example`),
  "",
);
check("low block names EXTENDED support", lowBlock.includes("Support level: EXTENDED"));
check("high block names MINIMAL support", highBlock.includes("Support level: MINIMAL"));
check(
  "blocks are observably different for low vs high",
  lowBlock !== highBlock,
);

// ---- (c) conservative-early: thin high signal does NOT get the leanest plan --
const thinHigh = profileWith(0.95, THIN_SIGNAL_OBSERVATIONS - 1);
const thinHighPlan = deriveSupportPlan(thinHigh, CONCEPT);
check(
  "thin high-mastery does not get 'minimal' (conservative early)",
  thinHighPlan.supportLevel !== "minimal",
  `${thinHighPlan.supportLevel} (obs=${thinHigh.conceptMastery[CONCEPT].observations})`,
);
check(
  "thin high-mastery is flagged thinSignal",
  thinHighPlan.thinSignal === true,
);
// A cold-start (unseen concept) is also conservative, never leanest.
const coldPlan = deriveSupportPlan(null, CONCEPT);
check(
  "cold-start profile is not 'minimal'",
  coldPlan.supportLevel !== "minimal",
  coldPlan.supportLevel,
);

// ---- (d) low-mastery floor: cannot go below extended -------------------------
check(
  "low-mastery is the most-supported plan (extended + most examples)",
  lowPlan.supportLevel === "extended" &&
    lowPlan.workedExamples >= highPlan.workedExamples,
);

// ---- (e) end-to-end through the Mock Call B generator ------------------------
async function endToEnd(): Promise<void> {
  const gen = new FakeLessonContentGenerator();
  const base = {
    conceptKey: CONCEPT,
    subject: { canonicalName: "Test subject", scopeNote: "scope" },
    goalpost: { order: 1, title: "Test goalpost", objective: "Do the thing." },
    experiencePrompt: "Apply the thing.",
    endAchievement: "be able to do the thing",
    assessment: [],
  };
  const lowLesson = await gen.generate({ ...base, profile: lowProfile });
  const highLesson = await gen.generate({ ...base, profile: highProfile });

  const countExamples = (md: string) =>
    (md.match(/### Worked example/g) ?? []).length;
  const lowCount = countExamples(lowLesson.content);
  const highCount = countExamples(highLesson.content);

  check(
    "Call B: low-mastery lesson has MORE worked-example sections than high",
    lowCount > highCount,
    `low=${lowCount} high=${highCount}`,
  );
  check(
    "Call B: low lesson reports supportLevel 'extended'",
    lowLesson.supportLevel === "extended",
    lowLesson.supportLevel,
  );
  check(
    "Call B: high lesson reports supportLevel 'minimal'",
    highLesson.supportLevel === "minimal",
    highLesson.supportLevel,
  );
  check(
    "Call B: low worked-example count matches the derived plan",
    lowCount === lowPlan.workedExamples,
    `lessonCount=${lowCount} plan=${lowPlan.workedExamples}`,
  );
}

await endToEnd();

console.log(
  `\nLOW plan: ${JSON.stringify({ s: lowPlan.supportLevel, w: lowPlan.workedExamples })}` +
    ` | HIGH plan: ${JSON.stringify({ s: highPlan.supportLevel, w: highPlan.workedExamples })}`,
);
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
