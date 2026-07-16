import type {
  SourcedVideo,
  VideoSearchInput,
} from "@/lib/services/visualMedia";

/**
 * A source of reference videos (e.g. a YouTube oEmbed lookup). Same testable
 * seam as ImageSource. The result is labelled an UNEVALUATED suggestion in
 * the UI (we do not vouch for third-party video content).
 */
export interface VideoSource {
  readonly providerName: string;
  resolve(input: VideoSearchInput): Promise<SourcedVideo | null>;
}
