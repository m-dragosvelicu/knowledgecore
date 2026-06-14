/**
 * Open PageRank domain-authority enrichment (free credibility signal).
 * API: GET https://openpagerank.com/api/v1.0/getPageRank?domains[]=...
 * Up to 100 domains per request. Returns a 0-10 decimal rank per domain.
 */

const BASE_URL = "https://openpagerank.com/api/v1.0/getPageRank";

interface OprResponse {
  response?: { domain: string; page_rank_decimal?: number | string; rank?: string | null }[];
}

/** domain (host) -> open pagerank 0-10, or null if unknown. */
export type PageRankMap = Record<string, number | null>;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function fetchPageRanks(domains: string[]): Promise<PageRankMap> {
  // .env value carries stray surrounding whitespace; trim so the header is valid.
  const key = process.env.OPENPAGERANK_API_KEY?.trim();
  if (!key) throw new Error("OPENPAGERANK_API_KEY is not set");

  const unique = [...new Set(domains.filter(Boolean))];
  const out: PageRankMap = {};

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const qs = batch.map((d) => `domains[]=${encodeURIComponent(d)}`).join("&");
    const res = await fetch(`${BASE_URL}?${qs}`, {
      headers: { "API-OPR": key },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Open PageRank request failed: ${res.status} ${text.slice(0, 120)}`);
    }
    const data = (await res.json()) as OprResponse;
    for (const r of data.response ?? []) {
      const v = typeof r.page_rank_decimal === "string" ? parseFloat(r.page_rank_decimal) : r.page_rank_decimal;
      out[r.domain] = v != null && !Number.isNaN(v) && v > 0 ? v : null;
    }
  }
  return out;
}
