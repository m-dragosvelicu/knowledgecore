/**
 * The gate: a simple switch keyed on the `visualKind` the content generator
 * emits (not an ML classifier — the model already decided the type). Routes:
 *   diagram/structural/quantitative -> SVG (sanitized on its own path)
 *   photographic/real_world/human/situational -> sourced license-clean image
 *   process/motion -> reference video embed
 * Every route is safe-by-construction: SVG goes through sanitizeSvg(), never
 * the markdown sanitizer; images come only from the injected ImageSource
 * (real attribution, or `none` on a miss); video is labelled unevaluated.
 */

import { sanitizeSvg } from "./svgSanitizer";
import type {
  ResolvedVisual,
  VisualKind,
  VisualMedium,
  VisualNeed,
} from "@/lib/services/visualMedia";
import type { ImageSource } from "@/lib/services/interfaces/imageSource.interface";
import type { VideoSource } from "@/lib/services/interfaces/videoSource.interface";

/**
 * The pure routing decision: visualKind -> medium. Exhaustive switch (no default
 * fall-through to a guess). Exported so the verify script asserts the mapping
 * directly.
 */
export function mediumForKind(kind: VisualKind): VisualMedium {
  switch (kind) {
    case "diagram":
    case "structural":
    case "quantitative":
      return "svg";
    case "photographic":
    case "real_world":
    case "human":
    case "situational":
      return "image";
    case "process":
    case "motion":
      return "video";
    default: {
      // Exhaustiveness guard: if a new VisualKind is added without a route, this
      // is a compile error. Image is the conservative fallback at runtime.
      const _exhaustive: never = kind;
      void _exhaustive;
      return "image";
    }
  }
}

export type VisualResolvers = {
  imageSource: ImageSource;
  videoSource: VideoSource;
};

/**
 * Resolve ONE visual need into a renderable, safe ResolvedVisual via the gate.
 * Each branch is independently safe; a failure in any branch degrades to a
 * `none` result so a bad visual never breaks the lesson.
 */
export async function routeVisual(
  need: VisualNeed,
  resolvers: VisualResolvers,
): Promise<ResolvedVisual> {
  const medium = mediumForKind(need.visualKind);

  if (medium === "svg") {
    // SVG route: the model authored markup; sanitize on the DEDICATED path.
    const result = sanitizeSvg(need.svgSource ?? "");
    if (!result.ok) {
      return {
        medium: "none",
        id: need.id,
        caption: need.caption,
        reason: "svg_sanitization_empty",
      };
    }
    return { medium: "svg", id: need.id, svg: result.svg, caption: need.caption };
  }

  if (medium === "image") {
    try {
      const sourced = await resolvers.imageSource.search({
        query: need.query ?? need.caption,
        safeSearch: true, // always on for learner-facing sourcing
      });
      if (!sourced) {
        return {
          medium: "none",
          id: need.id,
          caption: need.caption,
          reason: "no_license_clean_image",
        };
      }
      return {
        medium: "image",
        id: need.id,
        url: sourced.url,
        caption: need.caption,
        attribution: sourced.attribution,
      };
    } catch {
      return {
        medium: "none",
        id: need.id,
        caption: need.caption,
        reason: "image_source_error",
      };
    }
  }

  // video
  try {
    const video = await resolvers.videoSource.resolve({
      query: need.query ?? need.caption,
    });
    if (!video) {
      return {
        medium: "none",
        id: need.id,
        caption: need.caption,
        reason: "no_reference_video",
      };
    }
    return {
      medium: "video",
      id: need.id,
      embedUrl: video.embedUrl,
      caption: need.caption,
      provider: video.provider,
    };
  } catch {
    return {
      medium: "none",
      id: need.id,
      caption: need.caption,
      reason: "video_source_error",
    };
  }
}
