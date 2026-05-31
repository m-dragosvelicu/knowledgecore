import type {
  SourcedVideo,
  VideoSearchInput,
  VideoSource,
} from "@/lib/services/visualMedia";

/**
 * L1 Slice 4 — deterministic, offline reference-video source.
 *
 * No network. Returns a stable privacy-friendly (youtube-nocookie) embed URL so
 * the gate's video route and the verify script are testable without an oEmbed
 * call. An empty query yields null so the `none` path is exercisable.
 */
export class MockVideoSource implements VideoSource {
  readonly providerName = "YouTube";

  async resolve(input: VideoSearchInput): Promise<SourcedVideo | null> {
    const q = input.query.trim();
    if (q.length === 0) return null;

    // Stable fake video id derived from the query length (deterministic).
    const id = `mock${q.length.toString().padStart(7, "0")}`;
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      provider: this.providerName,
    };
  }
}
