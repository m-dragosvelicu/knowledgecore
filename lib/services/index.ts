import type { Services } from "@/lib/services/types";
import { MockIntentParser } from "@/lib/services/mock/mockIntentParser";
import { MockGoalInterviewer } from "@/lib/services/mock/mockGoalInterviewer";
import { MockKnowledgeProbe } from "@/lib/services/mock/mockKnowledgeProbe";
import { MockPathOutliner } from "@/lib/services/mock/mockPathOutliner";
import { MockCheckpointEvaluator } from "@/lib/services/mock/mockCheckpointEvaluator";

export * from "@/lib/services/types";

let warned = false;

function buildMock(): Services {
  return {
    intentParser: new MockIntentParser(),
    goalInterviewer: new MockGoalInterviewer(),
    knowledgeProbe: new MockKnowledgeProbe(),
    pathOutliner: new MockPathOutliner(),
    checkpointEvaluator: new MockCheckpointEvaluator(),
    mode: "mock",
  };
}

export function getServices(): Services {
  if (process.env.ANTHROPIC_API_KEY) {
    if (!warned) {
      // eslint-disable-next-line no-console
      console.warn("Live services not implemented; falling back to mock");
      warned = true;
    }
    return buildMock();
  }
  return buildMock();
}
