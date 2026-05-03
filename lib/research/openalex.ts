const BASE_URL = "https://api.openalex.org";

export interface OpenAlexAuthor {
  id?: string;
  name: string;
}

export interface OpenAlexWork {
  id: string;
  doi: string | null;
  title: string;
  abstract: string | null;
  publicationYear: number | null;
  citedByCount: number;
  authors: OpenAlexAuthor[];
  openAccessUrl: string | null;
}

interface RawAuthorship {
  author?: { id?: string; display_name?: string };
}

interface RawWork {
  id: string;
  doi: string | null;
  title: string | null;
  display_name?: string | null;
  abstract_inverted_index: Record<string, number[]> | null;
  publication_year: number | null;
  cited_by_count: number;
  authorships?: RawAuthorship[];
  open_access?: { oa_url?: string | null };
}

interface SearchResponse {
  results: RawWork[];
}

export interface SearchWorksOptions {
  perPage?: number;
  year?: number;
  openAccessOnly?: boolean;
}

function reconstructAbstract(
  inverted: Record<string, number[]> | null,
): string | null {
  if (!inverted) return null;
  const positions: Array<{ pos: number; word: string }> = [];
  for (const [word, posList] of Object.entries(inverted)) {
    for (const pos of posList) positions.push({ pos, word });
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ");
}

function mapWork(raw: RawWork): OpenAlexWork {
  return {
    id: raw.id,
    doi: raw.doi,
    title: raw.title ?? raw.display_name ?? "",
    abstract: reconstructAbstract(raw.abstract_inverted_index),
    publicationYear: raw.publication_year,
    citedByCount: raw.cited_by_count,
    authors: (raw.authorships ?? []).map((a) => ({
      id: a.author?.id,
      name: a.author?.display_name ?? "",
    })),
    openAccessUrl: raw.open_access?.oa_url ?? null,
  };
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const email = process.env.OPENALEX_EMAIL;
  if (email) url.searchParams.set("mailto", email);
  return url.toString();
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `OpenAlex request failed: ${res.status} ${res.statusText} for ${url}`,
    );
  }
  return (await res.json()) as T;
}

export async function searchWorks(
  query: string,
  opts: SearchWorksOptions = {},
): Promise<OpenAlexWork[]> {
  const filters: string[] = [];
  if (opts.year !== undefined) filters.push(`publication_year:${opts.year}`);
  if (opts.openAccessOnly) filters.push("open_access.is_oa:true");
  const params: Record<string, string> = {
    search: query,
    per_page: String(opts.perPage ?? 25),
  };
  if (filters.length) params.filter = filters.join(",");
  const url = buildUrl("/works", params);
  const data = await request<SearchResponse>(url);
  return data.results.map(mapWork);
}

export async function getWork(openAlexId: string): Promise<OpenAlexWork> {
  const id = openAlexId.replace(/^https?:\/\/openalex\.org\//, "");
  const url = buildUrl(`/works/${id}`, {});
  const raw = await request<RawWork>(url);
  return mapWork(raw);
}
