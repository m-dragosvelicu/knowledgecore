/**
 * Intent/depth router for the L2 Research Agent (ADR 9). Classifies goalpost
 * queries into a source tier: introductory/intermediate -> web (Tavily);
 * advanced/research-grade -> academic (OpenAlex, Semantic Scholar). Heuristic +
 * keyword-driven, no LLM call — inspects combined query text for research-grade
 * signals (citations, methodology, peer-review, etc.) vs intro signals
 * (overview, explain, beginners, etc.); ambiguous signals default to web tier
 * (ADR 9's B2C bias). Web tier is always tried; academic tier supplements (or
 * replaces, for research-grade) when depth warrants it.
 */

export type SourceTier = "web" | "academic" | "both";

export type DepthLabel = "introductory" | "intermediate" | "advanced" | "research-grade";

export interface RoutingDecision {
  tier: SourceTier;
  depth: DepthLabel;
  reason: string;
}

const ACADEMIC_SIGNALS: RegExp[] = [
  /\b(empirical|systematic review|meta.?analysis|peer.?review|randomized|rct|cohort)\b/i,
  /\b(citation|cite|bibliography|reference|doi|journal|conference paper)\b/i,
  /\b(methodology|quantitative|qualitative|statistical|hypothesis|experiment)\b/i,
  /\b(literature review|state of the art|seminal|foundational paper|academic)\b/i,
  /\b(research|study|studies|findings|evidence.?based)\b/i,
  /\b(theorem|proof|formal(ly)?|mathematical)\b/i,
];

const INTRO_SIGNALS: RegExp[] = [
  /\b(introduction|intro|overview|beginner|basics|101|primer|getting started)\b/i,
  /\b(explain|what is|what are|define|definition|understand|simple)\b/i,
  /\b(how to|tutorial|guide|example|practical|hands.?on)\b/i,
  /\b(summary|tldr|recap|brief)\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) count++;
  }
  return count;
}

/**
 * Route a set of goalpost queries to a source tier.
 * The topicLabel is also inspected (it provides broader topic context).
 */
export function routeQueries(
  topicLabel: string,
  goalpostQueries: string[],
): RoutingDecision {
  const combined = [topicLabel, ...goalpostQueries].join(" ");

  const academicScore = countMatches(combined, ACADEMIC_SIGNALS);
  const introScore = countMatches(combined, INTRO_SIGNALS);

  // Research-grade: strong academic signal with minimal intro signal.
  if (academicScore >= 3 && academicScore > introScore) {
    return {
      tier: "academic",
      depth: "research-grade",
      reason: `${academicScore} academic signals vs ${introScore} intro signals`,
    };
  }

  // Advanced: some academic signal, no dominant intro signal.
  if (academicScore >= 1 && introScore === 0) {
    return {
      tier: "both",
      depth: "advanced",
      reason: `${academicScore} academic signals, no intro signals; using both tiers`,
    };
  }

  // Intermediate: mixed signals — web tier is sufficient.
  if (academicScore >= 1 && introScore >= 1) {
    return {
      tier: "web",
      depth: "intermediate",
      reason: `mixed signals (academic=${academicScore}, intro=${introScore}); web tier`,
    };
  }

  // Introductory: predominantly intro signals or no signals at all.
  return {
    tier: "web",
    depth: "introductory",
    reason: `${introScore} intro signals, ${academicScore} academic signals; web tier`,
  };
}
