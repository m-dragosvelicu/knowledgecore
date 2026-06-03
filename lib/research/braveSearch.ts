/** Brave Search API adapter. https://api.search.brave.com/res/v1/web/search */
import type { SearchHit } from "./eval/types";

const BASE_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  url: string;
  title?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export async function braveSearch(
  query: string,
  maxResults = 8,
): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY is not set");

  const url = `${BASE_URL}?q=${encodeURIComponent(query)}&count=${maxResults}&country=us&search_lang=en`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Brave request failed: ${res.status} ${res.statusText} ${text.slice(0, 160)}`);
  }
  const data = (await res.json()) as BraveResponse;
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .slice(0, maxResults)
    .map((r) => ({
      url: r.url,
      title: r.title ?? "",
      // Brave descriptions contain <strong> highlight tags; strip them.
      snippet: (r.description ?? "").replace(/<[^>]+>/g, ""),
    }));
}
