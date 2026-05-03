const BASE_URL = "https://api.tavily.com";

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

  const body = {
    api_key: apiKey,
    query,
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
    throw new Error(
      `Tavily request failed: ${res.status} ${res.statusText} ${text}`,
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
