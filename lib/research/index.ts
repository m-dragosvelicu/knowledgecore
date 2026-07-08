export * from "./openalex";
export * from "./semanticScholar";
export * from "./tavily";
export * from "./firecrawl";

// L2 ingestion path (web tier under eval). Re-exported so the future Research
// Agent imports from one place once ADR 9 ratifies the engine.
export { searxngSearch } from "./searxng";
export { braveSearch } from "./braveSearch";
export { exaSearch } from "./exa";
export { extract } from "./extract";
export { fetchPageRanks, hostOf } from "./openPageRank";
export { routeQueries } from "./intentRouter";
export type { RoutingDecision, SourceTier, DepthLabel } from "./intentRouter";
