/** Shared types for the L2 ingestion bench. */

export type EngineName = "searxng" | "brave" | "exa" | "tavily";

/** A single search hit normalised across engines. */
export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

/** Result of one engine call for one query. */
export interface EngineResult {
  engine: EngineName;
  query: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  hits: SearchHit[];
}

/** Clean-text extraction outcome for one URL. */
export interface Extraction {
  url: string;
  ok: boolean;
  source: "trafilatura" | "jina" | "none";
  error?: string;
  text: string;
  title?: string | null;
  author?: string | null;
  date?: string | null;
  sitename?: string | null;
}
