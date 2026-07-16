/**
 * Verifies live wiring THROUGH the service registry (`getServices()`) — the
 * exact path the app uses. (A prior false positive came from bypassing
 * getServices() and constructing Live* classes directly; this deliberately
 * does not do that.)
 *
 * Live-only: with GOOGLE_GENAI_API_KEY set every service is a Live* instance
 * and mode === "live"; without the key getServices() fails fast.
 *
 * Run: `bun run scripts/verify-registry.ts`. Asserts fail-fast without the
 * key, mode/impl wiring, and one real end-to-end intent-parse call.
 */
import { getServices } from "@/lib/services";

function names(services: ReturnType<typeof getServices>) {
  return {
    intentParser: services.intentParser.constructor.name,
    goalInterviewer: services.goalInterviewer.constructor.name,
    knowledgeProbe: services.knowledgeProbe.constructor.name,
    pathOutliner: services.pathOutliner.constructor.name,
    checkpointEvaluator: services.checkpointEvaluator.constructor.name,
  };
}

async function main() {
  // ---- (a) fail-fast without a key ---------------------------------------------
  const savedKey = process.env.GOOGLE_GENAI_API_KEY;
  delete process.env.GOOGLE_GENAI_API_KEY;
  let threw = false;
  try {
    getServices();
  } catch {
    threw = true;
  } finally {
    if (savedKey !== undefined) process.env.GOOGLE_GENAI_API_KEY = savedKey;
  }
  if (!threw) {
    throw new Error("FAIL-FAST ASSERTION FAILED: getServices() did not throw with GOOGLE_GENAI_API_KEY unset");
  }
  console.log("FAIL-FAST PASS: getServices() throws when GOOGLE_GENAI_API_KEY is unset.");

  if (!process.env.GOOGLE_GENAI_API_KEY) {
    throw new Error("GOOGLE_GENAI_API_KEY is not set; cannot verify live registry wiring");
  }
  console.log("GOOGLE_GENAI_API_KEY present: true");

  const services = getServices();
  console.log("\nRegistry aggregate mode:", services.mode);
  console.log("Per-service constructor names:", JSON.stringify(names(services), null, 2));

  // ---- (b)+(c) live-wiring assertions ------------------------------------------
  if (services.mode !== "live") {
    throw new Error(`ASSERTION FAILED: expected mode="live", got "${services.mode}"`);
  }
  const expected: Record<string, string> = {
    intentParser: "LiveIntentParser",
    goalInterviewer: "LiveGoalInterviewer",
    knowledgeProbe: "LiveKnowledgeProbe",
    pathOutliner: "LivePathOutliner",
    checkpointEvaluator: "LiveCheckpointEvaluator",
  };
  const actual = names(services);
  for (const [k, v] of Object.entries(expected)) {
    if ((actual as Record<string, string>)[k] !== v) {
      throw new Error(`ASSERTION FAILED: ${k} expected ${v}, got ${(actual as Record<string, string>)[k]}`);
    }
  }
  console.log("\nLIVE-WIRING PASS: mode=live and all five impls are Live* instances.");

  // ---- (d) real end-to-end call through a registry-obtained service ------------
  console.log("\nMaking ONE real intent-parse call through getServices().intentParser ...");
  const subject = await getServices().intentParser.parse(
    "I want to learn linear algebra for ML",
  );
  console.log("Real Gemini result:\n" + JSON.stringify(subject, null, 2));
  console.log("\nEND-TO-END PASS: the app registry path reached live Gemini.");
}

main().catch((err) => {
  console.error("\nVERIFY-REGISTRY FAILED:");
  console.error(err);
  process.exit(1);
});
