import type {
  ImageSearchInput,
  SourcedImage,
} from "@/lib/services/visualMedia";

/**
 * A source of LICENSE-CLEAN images. The ONLY allowed source family in L1 is
 * Creative-Commons / public-domain (Openverse). An implementation MUST NOT pull
 * arbitrary web images and MUST return real attribution. A test double behind
 * this interface keeps the gate testable offline (see verify-visual-media.ts).
 */
export interface ImageSource {
  /** Stable identifier of the source, surfaced in attribution (e.g. "Openverse"). */
  readonly sourceName: string;
  /** Returns the best license-clean match, or null if none was found. */
  search(input: ImageSearchInput): Promise<SourcedImage | null>;
}
