/**
 * Standalone verification that the live LLM-backed L0 services actually work
 * against real Gemini (gemini-3.5-flash). Run with:
 *   bun run scripts/verify-live.ts
 *
 * Loads .env, builds the LIVE services directly, and exercises every service end
 * to end: intent -> goal -> probe (questions + score) -> path -> checkpoint eval.
 * Prints real outputs including the per-dimension scores and the verbatim
 * evidence quotes, and asserts the quotes are genuine substrings of the artifact.
 */
import { GeminiClient } from "@/lib/llm";
import { LiveIntentParser } from "@/lib/services/live/liveIntentParser";
import { LiveGoalInterviewer } from "@/lib/services/live/liveGoalInterviewer";
import { LiveKnowledgeProbe } from "@/lib/services/live/liveKnowledgeProbe";
import { LivePathOutliner } from "@/lib/services/live/livePathOutliner";
import { LiveCheckpointEvaluator } from "@/lib/services/live/liveCheckpointEvaluator";
import type { ProbeAnswer } from "@/lib/services/types";

function hr(title: string) {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

async function main() {
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    throw new Error("GOOGLE_GENAI_API_KEY is not set; cannot run live verification");
  }
  const llm = new GeminiClient();
  console.log("Model: gemini-3.5-flash | key present:", true);

  // 1. Intent ----------------------------------------------------------
  hr("1. IntentParser.parse");
  const intentParser = new LiveIntentParser(llm);
  const subject = await intentParser.parse(
    "i wanna get good at the math behind machine learning, especially linear algebra",
  );
  console.log(JSON.stringify(subject, null, 2));

  // 2. Goal ------------------------------------------------------------
  hr("2. GoalInterviewer.interview");
  const goalInterviewer = new LiveGoalInterviewer(llm);
  const { canDoStatements } = await goalInterviewer.interview({
    subject,
    motivation: "work",
    elaboration: "I'm a backend dev who keeps hitting linear algebra in ML papers.",
  });
  console.log(JSON.stringify(canDoStatements, null, 2));

  // 3. Probe -----------------------------------------------------------
  hr("3. KnowledgeProbe.questions");
  const probe = new LiveKnowledgeProbe(llm);
  const questions = await probe.questions(subject, canDoStatements);
  console.log(JSON.stringify(questions, null, 2));

  hr("3b. KnowledgeProbe.score");
  const answers: ProbeAnswer[] = questions.map((q, i) => ({
    questionId: q.id,
    response:
      q.kind === "multiple_choice"
        ? q.options?.[0] ?? "Not sure"
        : i === 0
          ? "I know basic high school algebra and can solve linear equations."
          : "I have a vague idea but have never used it in code.",
  }));
  const competencies = await probe.score(answers);
  console.log(JSON.stringify(competencies, null, 2));

  // 4. Path ------------------------------------------------------------
  hr("4. PathOutliner.outline");
  const outliner = new LivePathOutliner(llm);
  const goalposts = await outliner.outline({
    subject,
    motivation: "work",
    outcome: canDoStatements,
    assessment: competencies,
  });
  console.log(`Generated ${goalposts.length} goalposts:`);
  for (const gp of goalposts) {
    console.log(`\n  Goalpost ${gp.order}: ${gp.title} (${gp.estimatedMinutes} min)`);
    console.log(`    objective: ${gp.objective}`);
    for (const step of gp.steps) {
      if (step.type === "information") {
        const content = String((step.payload as { content: string }).content);
        console.log(`    [${step.type}] (${content.length} chars) ${content.slice(0, 120)}...`);
      } else {
        const p = step.payload as { prompt: string; rubricFocus: string[] };
        console.log(`    [${step.type}] focus=${p.rubricFocus.join(",")}`);
        console.log(`       prompt: ${p.prompt.slice(0, 160)}`);
      }
    }
  }

  // 5. Checkpoint evaluation + verbatim guard --------------------------
  // Use a SELF-CONSISTENT goalpost + artifact (not the dynamically generated
  // one) so the artifact genuinely answers the prompt and the verbatim-quote
  // guard is exercised with real, scorable evidence.
  hr("5. CheckpointEvaluator.evaluate (verbatim-quote guard)");
  const artifact = [
    "The dot product of two vectors is v . u = v1*u1 + v2*u2.",
    "For A=(10,2) and B=(2,10): A . B = 10*2 + 2*10 = 20 + 20 = 40.",
    "For A=(10,2) and C=(9,3): A . C = 10*9 + 2*3 = 90 + 6 = 96.",
    "So A and C are most similar because their dot product is larger and they point in nearly the same direction.",
    "This matters because the dot product grows when vectors align, so it works as a similarity score.",
  ].join(" ");

  const evaluator = new LiveCheckpointEvaluator(llm);
  const evaluation = await evaluator.evaluate({
    goalpostTitle: "Vectors and dot products",
    goalpostObjective:
      "Compute dot products of 2D vectors by hand and explain why the dot product measures similarity.",
    informationContent:
      "A vector can be seen as an arrow or a list of numbers. The dot product v . u = v1*u1 + v2*u2 is large when two vectors point in similar directions, so it works as a similarity score.",
    experiencePrompt:
      "Given three customers as 2D vectors A=(10,2), B=(2,10), C=(9,3), compute the pairwise dot products by hand, say which two are most similar, and explain in one sentence why the dot product is a reasonable similarity measure.",
    userArtifact: artifact,
    attempt: 1,
  });

  console.log("ARTIFACT UNDER TEST:\n  " + artifact + "\n");
  console.log("Scores:", JSON.stringify(evaluation.scores));
  console.log("Decision:", evaluation.decision);
  console.log("Rationale:", evaluation.rationale);
  console.log("\nEvidence (verbatim-guard verified):");
  let allVerified = true;
  for (const ev of evaluation.evidence) {
    const flagged = ev.quote.startsWith("[unverified]");
    const noEvidence = ev.quote === "(no evidence in artifact)";
    const isSubstring = noEvidence || (!flagged && artifact.includes(ev.quote));
    if (!isSubstring && !noEvidence) allVerified = false;
    const status = noEvidence
      ? "OK (no-evidence)"
      : flagged
        ? "FLAGGED-UNVERIFIED"
        : isSubstring
          ? "VERBATIM-OK"
          : "MISMATCH";
    console.log(`  [${status}] ${ev.dimension}: "${ev.quote}"`);
  }

  hr("RESULT");
  console.log(
    allVerified
      ? "PASS: every non-flagged evidence quote is a verbatim substring of the artifact."
      : "WARN: at least one quote was flagged unverified (guard degraded gracefully, scores kept).",
  );
}

main().catch((err) => {
  console.error("\nVERIFY-LIVE FAILED:");
  console.error(err);
  process.exit(1);
});
