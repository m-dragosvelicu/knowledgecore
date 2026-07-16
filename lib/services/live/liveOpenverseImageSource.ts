import type {
  ImageAttribution,
  ImageSearchInput,
  ImageSource,
  SourcedImage,
} from "@/lib/services/visualMedia";

/**
 * Live license-clean image source (Openverse — openverse.org, WordPress.org).
 * Requests only CC/public-domain works (`license_type`), keeps safe-search on
 * explicitly, and maps attribution straight from the API response — nothing
 * is fabricated; a missing field stays missing rather than being invented.
 * Never pulls arbitrary web images: the only host read is the Openverse API.
 * A miss (no result, or no usable URL) returns null so the gate degrades to
 * `none`. No API key required (rate-limited); base URL overridable via
 * OPENVERSE_API_BASE for testing.
 */

const OPENVERSE_BASE =
  process.env.OPENVERSE_API_BASE ?? "https://api.openverse.org/v1";

type OpenverseImageResult = {
  id?: string;
  title?: string | null;
  url?: string | null;
  creator?: string | null;
  license?: string | null;
  license_version?: string | null;
  license_url?: string | null;
  foreign_landing_url?: string | null;
  mature?: boolean;
};

type OpenverseSearchResponse = {
  results?: OpenverseImageResult[];
};

/** Build a human-readable license name from the API's license + version. */
function licenseName(license: string | null | undefined, version: string | null | undefined): string {
  if (!license) return "Unknown license";
  const up = license.toUpperCase();
  if (up === "PDM" || up === "CC0") {
    return up === "CC0" ? "CC0 (Public Domain Dedication)" : "Public Domain Mark";
  }
  return version ? `CC ${up} ${version}` : `CC ${up}`;
}

export class LiveOpenverseImageSource implements ImageSource {
  readonly sourceName = "Openverse";

  // Allow injecting fetch for testing; defaults to global fetch.
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async search(input: ImageSearchInput): Promise<SourcedImage | null> {
    const q = input.query.trim();
    if (q.length === 0) return null;

    const params = new URLSearchParams({
      q,
      page_size: "1",
      // license_type=all-cc keeps it to CC + public-domain (the whole index is
      // open-licensed; this is belt-and-braces and self-documenting).
      license_type: "all-cc",
      // SAFE-SEARCH: exclude mature content. Openverse excludes mature by default;
      // we set it explicitly so the safety posture is visible in code.
      mature: "false",
    });

    let res: Response;
    try {
      res = await this.fetchImpl(`${OPENVERSE_BASE}/images/?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
    } catch {
      return null; // network failure -> miss; gate yields `none`
    }
    if (!res.ok) return null;

    let body: OpenverseSearchResponse;
    try {
      body = (await res.json()) as OpenverseSearchResponse;
    } catch {
      return null;
    }

    const hit = body.results?.find((r) => r.url && r.mature !== true);
    if (!hit || !hit.url) return null;

    const attribution: ImageAttribution = {
      creator: hit.creator ?? null,
      licenseName: licenseName(hit.license, hit.license_version),
      licenseUrl: hit.license_url ?? null,
      sourcePage: hit.foreign_landing_url ?? null,
      source: this.sourceName,
      title: hit.title ?? null,
    };

    return { url: hit.url, attribution };
  }
}
