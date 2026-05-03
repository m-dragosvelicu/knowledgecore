const BASE_URL = "https://api.firecrawl.dev/v1";

export interface FirecrawlMetadata {
  title?: string;
  description?: string;
  sourceUrl: string;
}

export interface FirecrawlScrapeResult {
  markdown?: string;
  html?: string;
  metadata: FirecrawlMetadata;
}

export interface ScrapeOptions {
  formats?: Array<"markdown" | "html">;
}

interface RawScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      url?: string;
    };
  };
  error?: string;
}

export async function scrapeUrl(
  url: string,
  opts: ScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  const body = {
    url,
    formats: opts.formats ?? ["markdown"],
  };

  const res = await fetch(`${BASE_URL}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Firecrawl request failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  const json = (await res.json()) as RawScrapeResponse;
  if (!json.success || !json.data) {
    throw new Error(`Firecrawl scrape failed: ${json.error ?? "unknown error"}`);
  }

  const meta = json.data.metadata ?? {};
  return {
    markdown: json.data.markdown,
    html: json.data.html,
    metadata: {
      title: meta.title,
      description: meta.description,
      sourceUrl: meta.sourceURL ?? meta.url ?? url,
    },
  };
}
