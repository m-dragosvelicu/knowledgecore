/**
 * L1 — Two-Phase Visual Lesson Pipeline.
 *
 * TODO(Slice 3 — AI + Visualization Engineer): REPLACE these stubs with the real
 * Phase-2 visual workers.
 *   - The SVG worker is a DEDICATED, focused model call whose entire output is
 *     one SVG, then sanitizeSvg(); it retries on junk/empty output before
 *     dropping (redesign §7).
 *   - The image / video workers search the EXISTING license-clean sources
 *     (Openverse image, reference-video) from the spec.
 * Each worker implements the `VisualWorker` port in lessonOrchestration.ts:
 * `resolve(input) -> ResolvedVisual` (medium svg|image|video on success; `none`
 * or throw on TERMINAL failure — never a broken/placeholder visual).
 *
 * Until Slice 3 lands, these stubs are SAFE-DEGRADING: they return a `none`
 * ResolvedVisual, so the orchestrator DROPS every visual slot and the lesson
 * still assembles complete from prose alone (prose stands alone by contract).
 * This keeps the foundation runnable and the reveal invariant intact (a dropped
 * visual is acceptable; a broken one is not) without inventing real worker logic
 * that belongs to Slice 3.
 *
 * The image/video stubs DO reuse the existing gate-resolver shapes (ImageSource /
 * VideoSource) so Slice 3 can swap in real sourcing with the spec-as-query seam
 * already wired; the SVG stub has no analogous source (the model authors it), so
 * it is a pure drop until Slice 3 supplies the focused SVG call.
 */

import type {
  VisualWorker,
  VisualWorkerInput,
  VisualWorkers,
} from "@/lib/journey/lessonOrchestration";
import type {
  ImageSource,
  ResolvedVisual,
  VideoSource,
} from "@/lib/services/visualMedia";

/** SVG worker stub: no source to draw from yet -> drop the slot. */
export class SvgWorkerStub implements VisualWorker {
  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    // TODO(Slice 3): focused SVG authoring call + sanitizeSvg + retry-on-junk.
    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "svg_worker_not_implemented",
    };
  }
}

/** Image worker stub: searches the license-clean source from the spec. */
export class ImageWorkerStub implements VisualWorker {
  constructor(private readonly imageSource: ImageSource) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    // TODO(Slice 3): spec -> tighter query derivation + quality bar + retry.
    try {
      const sourced = await this.imageSource.search({
        query: input.spec,
        safeSearch: true,
      });
      if (!sourced) {
        return {
          medium: "none",
          id: input.id,
          caption: input.spec,
          reason: "no_license_clean_image",
        };
      }
      return {
        medium: "image",
        id: input.id,
        url: sourced.url,
        caption: input.spec,
        attribution: sourced.attribution,
      };
    } catch {
      return {
        medium: "none",
        id: input.id,
        caption: input.spec,
        reason: "image_source_error",
      };
    }
  }
}

/** Video worker stub: resolves a reference embed from the spec. */
export class VideoWorkerStub implements VisualWorker {
  constructor(private readonly videoSource: VideoSource) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    // TODO(Slice 3): spec -> reference-video search + suggestion labelling.
    try {
      const video = await this.videoSource.resolve({ query: input.spec });
      if (!video) {
        return {
          medium: "none",
          id: input.id,
          caption: input.spec,
          reason: "no_reference_video",
        };
      }
      return {
        medium: "video",
        id: input.id,
        embedUrl: video.embedUrl,
        caption: input.spec,
        provider: video.provider,
      };
    } catch {
      return {
        medium: "none",
        id: input.id,
        caption: input.spec,
        reason: "video_source_error",
      };
    }
  }
}

/** Assemble the per-medium worker set the orchestrator fans out to. */
export function buildVisualWorkerStubs(resolvers: {
  imageSource: ImageSource;
  videoSource: VideoSource;
}): VisualWorkers {
  return {
    svg: new SvgWorkerStub(),
    image: new ImageWorkerStub(resolvers.imageSource),
    video: new VideoWorkerStub(resolvers.videoSource),
  };
}
