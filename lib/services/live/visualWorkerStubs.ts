// Offline / keyless fallback visual workers. Safe-degrading: the SVG worker drops
// (no source), the image/video workers search the keyless sources directly. A dropped
// slot is acceptable; the live workers (liveVisualWorkers.ts) are the real path.

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

/** SVG worker stub: no keyless source to draw from -> drop the slot. */
export class SvgWorkerStub implements VisualWorker {
  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "svg_worker_not_implemented",
    };
  }
}

/** Image worker stub: searches the license-clean source with the raw spec. */
export class ImageWorkerStub implements VisualWorker {
  constructor(private readonly imageSource: ImageSource) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
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
