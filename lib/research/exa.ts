/** Exa search adapter. https://api.exa.ai/search (auto search type). */
import type { SearchHit } from "./eval/types";

const BASE_URL = "https://api.exa.ai/search";

interface ExaResult {
  url: string;
  title?: string | null;
  text?: string | null;
  snippet?: string | null;
}

interface ExaResponse {
  results?: ExaResult[];
}

export async function exaSearch(
  query: string,
  maxResults = 8,
): Promise<SearchHit[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: maxResults,
      contents: { text: { maxCharacters: 500 } },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Exa request failed: ${res.status} ${res.statusText} ${text.slice(0, 160)}`);
  }
  const data = (await res.json()) as ExaResponse;
  return (data.results ?? [])
    .filter((r) => r.url)
    .slice(0, maxResults)
    .map((r) => ({
      url: r.url,
      title: r.title ?? "",
      snippet: (r.snippet ?? r.text ?? "").slice(0, 400),
    }));
}
