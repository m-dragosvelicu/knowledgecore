import { clampQuery } from "./queryBuilder";

const BASE_URL = "https://api.tavily.com";

/** A non-2xx response from Tavily. A 4xx here is a malformed-request bug on
 * our side (e.g. a query that slipped past the length guard), not a
 * transient network issue; callers should log it distinctly from network
 * flakiness rather than folding it into a generic "no results" degrade. */
export class TavilyRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TavilyRequestError";
  }
}

export interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  rawContent?: string | null;
}

interface RawTavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  raw_content?: string | null;
}

interface SearchResponse {
  results: RawTavilyResult[];
}

export interface WebSearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeRawContent?: boolean;
}

export async function webSearch(
  query: string,
  opts: WebSearchOptions = {},
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");

  const safeQuery = clampQuery(query, "tavily");

  const body = {
    api_key: apiKey,
    query: safeQuery,
    max_results: opts.maxResults ?? 10,
    search_depth: opts.searchDepth ?? "basic",
    include_raw_content: opts.includeRawContent ?? false,
  };

  const res = await fetch(`${BASE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TavilyRequestError(
      res.status,
      `Tavily request failed: ${res.status} ${res.statusText} ${text} | query="${safeQuery.slice(0, 120)}"${safeQuery.length > 120 ? "..." : ""}`,
    );
  }

  const data = (await res.json()) as SearchResponse;
  return (data.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    content: r.content,
    score: r.score,
    rawContent: r.raw_content ?? null,
  }));
}
