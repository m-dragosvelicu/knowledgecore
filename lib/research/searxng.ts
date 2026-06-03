/**
 * SearXNG meta-search adapter (self-hosted via docker-compose.eval.yml).
 * Queries the JSON API of the local SearXNG instance.
 */
import type { SearchHit } from "./eval/types";

const BASE_URL = process.env.SEARXNG_URL ?? "http://localhost:8088";

interface RawSearxResult {
  url: string;
  title?: string;
  content?: string;
}

interface SearxResponse {
  results?: RawSearxResult[];
}

export async function searxngSearch(
  query: string,
  maxResults = 8,
): Promise<SearchHit[]> {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SearXNG request failed: ${res.status} ${res.statusText} ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as SearxResponse;
  return (data.results ?? [])
    .filter((r) => r.url)
    .slice(0, maxResults)
    .map((r) => ({ url: r.url, title: r.title ?? "", snippet: r.content ?? "" }));
}
