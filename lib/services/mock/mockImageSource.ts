import type {
  ImageSearchInput,
  ImageSource,
  SourcedImage,
} from "@/lib/services/visualMedia";

/**
 * L1 Slice 4 — deterministic, offline image source.
 *
 * No network. It returns a stable, license-clean-SHAPED result so the gate and
 * the verify script can assert the contract (image route -> a URL + REAL
 * attribution from the allowed source) without hitting Openverse. The attribution
 * is well-formed and explicitly marked Creative-Commons, mirroring the live
 * client's mapping, so the "carries attribution + only the allowed source" check
 * passes deterministically.
 *
 * An empty query yields null (no match) so the gate's `none` path is exercisable.
 */
export class MockImageSource implements ImageSource {
  readonly sourceName = "Openverse";

  async search(input: ImageSearchInput): Promise<SourcedImage | null> {
    const q = input.query.trim();
    if (q.length === 0) return null;

    // Deterministic pseudo-id from the query so repeated calls are stable.
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      url: `https://mock.openverse.test/image/${slug}.jpg`,
      attribution: {
        creator: "Jane Mock",
        licenseName: "CC BY 2.0",
        licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
        sourcePage: `https://mock.openverse.test/photos/${slug}`,
        source: this.sourceName,
        title: `Mock photo of ${q}`,
      },
    };
  }
}
