/**
 * Verifies the LIVE wiring THROUGH the service registry (`getServices()`) — i.e. the exact
 * code path the web app uses. The prior false positive came from bypassing `getServices()`
 * and constructing Live* classes directly; this script deliberately does NOT do that.
 *
 * Run with:
 *   bun run scripts/verify-registry.ts
 *   LIVE_INTENT_PARSER=false bun run scripts/verify-registry.ts   # opt-out demo
 *
 * Asserts:
 *   (a) services.mode === "live" when GOOGLE_GENAI_API_KEY is present and no opt-out flags set
 *   (b) each impl is the Live* class instance (constructor.name), NOT the Mock* one
 *   (c) a real end-to-end intent parse through a registry-obtained service reaches Gemini
 *   (d) opt-out: LIVE_INTENT_PARSER=false makes intentParser Mock while the rest stay Live,
 *       and the aggregate mode flips to "mock"
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
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    throw new Error("GOOGLE_GENAI_API_KEY is not set; cannot verify live registry wiring");
  }

  const optOut = process.env.LIVE_INTENT_PARSER === "false";
  console.log("GOOGLE_GENAI_API_KEY present: true");
  console.log("LIVE_INTENT_PARSER =", JSON.stringify(process.env.LIVE_INTENT_PARSER ?? "(unset)"));

  const services = getServices();
  console.log("\nRegistry aggregate mode:", services.mode);
  console.log("Per-service constructor names:", JSON.stringify(names(services), null, 2));

  if (optOut) {
    // ---- Opt-out demonstration -------------------------------------------------
    const n = names(services);
    const ok =
      services.mode === "mock" &&
      n.intentParser === "MockIntentParser" &&
      n.goalInterviewer === "LiveGoalInterviewer" &&
      n.knowledgeProbe === "LiveKnowledgeProbe" &&
      n.pathOutliner === "LivePathOutliner" &&
      n.checkpointEvaluator === "LiveCheckpointEvaluator";
    if (!ok) {
      throw new Error("OPT-OUT ASSERTION FAILED: expected intentParser=Mock, others=Live, mode=mock");
    }
    console.log("\nOPT-OUT PASS: intentParser fell back to Mock, the other four stayed Live, mode=mock.");
    return;
  }

  // ---- Default-to-live assertions ----------------------------------------------
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

  // ---- Real end-to-end call through a registry-obtained service ----------------
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
