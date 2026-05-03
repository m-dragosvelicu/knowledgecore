const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const RECOMMENDATIONS_BASE_URL =
  "https://api.semanticscholar.org/recommendations/v1";

const DEFAULT_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "year",
  "citationCount",
  "authors",
  "url",
  "openAccessPdf",
];

export interface SemanticScholarAuthor {
  authorId: string | null;
  name: string;
}

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  citationCount: number | null;
  authors: SemanticScholarAuthor[];
  url: string | null;
  openAccessPdf: { url: string; status?: string } | null;
}

interface RawPaper {
  paperId: string;
  title: string | null;
  abstract: string | null;
  year: number | null;
  citationCount: number | null;
  authors?: Array<{ authorId: string | null; name: string }>;
  url: string | null;
  openAccessPdf: { url: string; status?: string } | null;
}

interface SearchResponse {
  total?: number;
  data: RawPaper[];
}

interface RecommendationResponse {
  recommendedPapers: RawPaper[];
}

export interface SearchPapersOptions {
  limit?: number;
  fields?: string[];
}

function mapPaper(raw: RawPaper): SemanticScholarPaper {
  return {
    paperId: raw.paperId,
    title: raw.title ?? "",
    abstract: raw.abstract,
    year: raw.year,
    citationCount: raw.citationCount,
    authors: (raw.authors ?? []).map((a) => ({
      authorId: a.authorId,
      name: a.name,
    })),
    url: raw.url,
    openAccessPdf: raw.openAccessPdf,
  };
}

function headers(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (key) h["x-api-key"] = key;
  return h;
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(
      `Semantic Scholar request failed: ${res.status} ${res.statusText} for ${url}`,
    );
  }
  return (await res.json()) as T;
}

export async function searchPapers(
  query: string,
  opts: SearchPapersOptions = {},
): Promise<SemanticScholarPaper[]> {
  const url = new URL(`${BASE_URL}/paper/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(opts.limit ?? 20));
  url.searchParams.set("fields", (opts.fields ?? DEFAULT_FIELDS).join(","));
  const data = await request<SearchResponse>(url.toString());
  return (data.data ?? []).map(mapPaper);
}

export async function getRecommendations(
  paperId: string,
): Promise<SemanticScholarPaper[]> {
  const url = new URL(
    `${RECOMMENDATIONS_BASE_URL}/papers/forpaper/${paperId}`,
  );
  url.searchParams.set("fields", DEFAULT_FIELDS.join(","));
  const data = await request<RecommendationResponse>(url.toString());
  return (data.recommendedPapers ?? []).map(mapPaper);
}
