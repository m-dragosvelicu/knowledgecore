import type {
  SourcedVideo,
  VideoSearchInput,
  VideoSource,
} from "@/lib/services/visualMedia";

/**
 * L1 Slice 4 — the LIVE reference-video source (YouTube).
 *
 * SCOPE NOTE: video is a REFERENCE suggestion for motion/process concepts and is
 * labelled "unevaluated" in the UI — we do not vouch for third-party content. The
 * generator supplies a `query`; in L1 that query is expected to be a concrete
 * YouTube watch URL or video id the content step proposes (full search-ranking is
 * out of scope). This source validates + normalizes it into a privacy-friendly
 * `youtube-nocookie` embed URL, optionally confirming the id resolves via the
 * keyless oEmbed endpoint. A non-resolvable id returns null so the gate degrades
 * to a `none` result rather than embedding a dead/arbitrary video.
 */

const YT_ID = /^[a-zA-Z0-9_-]{11}$/;

/** Pull an 11-char YouTube video id out of a watch/short/embed URL or bare id. */
export function extractYouTubeId(input: string): string | null {
  const s = input.trim();
  if (YT_ID.test(s)) return s;
  // Match common URL shapes without executing anything.
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

export class LiveYouTubeVideoSource implements VideoSource {
  readonly providerName = "YouTube";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(input: VideoSearchInput): Promise<SourcedVideo | null> {
    const id = extractYouTubeId(input.query ?? "");
    if (!id) return null;

    // Confirm the id resolves via the keyless oEmbed endpoint. If oEmbed fails
    // (private/removed/invalid), treat it as a miss.
    try {
      const watch = `https://www.youtube.com/watch?v=${id}`;
      const res = await this.fetchImpl(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) return null;
    } catch {
      return null;
    }

    return {
      // Privacy-enhanced mode: youtube-nocookie does not set tracking cookies
      // until the learner plays the video.
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      provider: this.providerName,
    };
  }
}
