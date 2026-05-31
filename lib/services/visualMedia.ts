/**
 * L1 Slice 4 — the visual-media contract (the visualKind gate + media sources).
 *
 * The content-generating LLM emits, per visual NEED, a structured `visualKind`
 * field. A SIMPLE SWITCH (NOT an ML classifier) routes each need to a concrete
 * medium:
 *
 *   diagram / structural / quantitative  -> AI-generated SVG (sanitized on its
 *                                            OWN dedicated render path)
 *   photographic / real-world / human /
 *   situational                          -> a license-clean SOURCED image
 *                                            (Openverse: CC / public-domain only,
 *                                             with real attribution + safe-search)
 *   process / motion                     -> a reference VIDEO embed (an
 *                                            unevaluated suggestion)
 *
 * This contract is ADDITIVE — it lives ALONGSIDE the LOCKED `lib/services/types.ts`
 * interface boundary (which must not change), mirroring lessonContent.ts /
 * pathConfirmation.ts / transcription.ts. The image + video sources are wired
 * through the registry with the same default-to-live + per-service opt-out +
 * graceful mock-fallback pattern, so the whole slice is testable WITHOUT network.
 *
 * SAFETY BOUNDARY: generated SVG is CODE. It is sanitized on its own dedicated
 * path (lib/services/visual/svgSanitizer.ts) and NEVER routed through the
 * lesson-text markdown sanitizer (components/Markdown.tsx). See routeVisual().
 */

import type { Competency } from "@/lib/services/types";

// =====================================================================
// visualKind — the structured field the content generator emits per visual.
// A closed set so the gate is an exhaustive switch, not a free-text guess.
// =====================================================================
export const VISUAL_KINDS = [
  "diagram", // structural / quantitative -> SVG
  "structural", // alias bucket for diagram-route concepts
  "quantitative", // chart-like; still an SVG in L1 (no raster generation)
  "photographic", // a real-world photo -> sourced image
  "real_world", // real-world scene/object -> sourced image
  "human", // a human subject -> sourced image
  "situational", // a situation/context photo -> sourced image
  "process", // a step-by-step process -> reference video
  "motion", // motion/dynamics -> reference video
] as const;

export type VisualKind = (typeof VISUAL_KINDS)[number];

/** The three concrete media a visualKind routes to. */
export type VisualMedium = "svg" | "image" | "video";

/**
 * One visual NEED as emitted by the content generator. The generator decides
 * WHAT a visual should show and tags it with a `visualKind`; the gate decides
 * HOW it is realised. `svgSource` is present only for SVG-route needs (the model
 * authored the SVG inline); image/video routes carry a search query the source
 * resolves.
 */
export type VisualNeed = {
  /** Stable id for this visual within the goalpost (for feedback wiring). */
  id: string;
  /** The structured routing field. The gate keys ONLY off this. */
  visualKind: VisualKind;
  /** A one-line description / alt text the model wrote for accessibility. */
  caption: string;
  /** A short search query (image/video routes). Ignored for the SVG route. */
  query?: string;
  /** Raw SVG markup the model authored (SVG route only). UNTRUSTED CODE. */
  svgSource?: string;
};

// =====================================================================
// Resolved media — what the gate produces, ready for the VisualMedia component.
// =====================================================================

/** A sanitized, safe-to-render inline SVG. */
export type ResolvedSvg = {
  medium: "svg";
  id: string;
  /** Sanitized SVG markup (post svgSanitizer). Safe to inline. */
  svg: string;
  caption: string;
};

/** A sourced, attributed, license-clean image. */
export type ResolvedImage = {
  medium: "image";
  id: string;
  url: string;
  caption: string;
  /** Real, checkable attribution — never fabricated. */
  attribution: ImageAttribution;
};

/** An embedded reference video, labelled an unevaluated suggestion. */
export type ResolvedVideo = {
  medium: "video";
  id: string;
  /** A privacy-friendly embed URL (e.g. youtube-nocookie). */
  embedUrl: string;
  caption: string;
  provider: string;
};

/** A visual the gate could not resolve (no license-clean image found, etc.). */
export type ResolvedNone = {
  medium: "none";
  id: string;
  caption: string;
  reason: string;
};

export type ResolvedVisual =
  | ResolvedSvg
  | ResolvedImage
  | ResolvedVideo
  | ResolvedNone;

// =====================================================================
// Image sourcing — license-clean ONLY. Never arbitrary web images.
// =====================================================================

/**
 * Real, checkable attribution for a sourced image. Every field comes from the
 * source API response; NOTHING here is fabricated. Displayed with the image.
 */
export type ImageAttribution = {
  /** Creator / author as reported by the source. */
  creator: string | null;
  /** Human-readable license name (e.g. "CC BY 2.0", "Public Domain"). */
  licenseName: string;
  /** Canonical URL of the license deed. */
  licenseUrl: string | null;
  /** Link back to the source page for the work (provenance). */
  sourcePage: string | null;
  /** The source/provider this image came from (e.g. "Openverse"). */
  source: string;
  /** Title of the work, if reported. */
  title: string | null;
};

export type ImageSearchInput = {
  /** Free-text query describing the needed photo. */
  query: string;
  /** SAFE-SEARCH is always on for learner-facing sourcing; kept explicit. */
  safeSearch?: boolean;
};

export type SourcedImage = {
  url: string;
  attribution: ImageAttribution;
};

/**
 * A source of LICENSE-CLEAN images. The ONLY allowed source family in L1 is
 * Creative-Commons / public-domain (Openverse). An implementation MUST NOT pull
 * arbitrary web images and MUST return real attribution. Behind the registry
 * mock/live pattern so the gate is testable offline.
 */
export interface ImageSource {
  /** Stable identifier of the source, surfaced in attribution (e.g. "Openverse"). */
  readonly sourceName: string;
  /** Returns the best license-clean match, or null if none was found. */
  search(input: ImageSearchInput): Promise<SourcedImage | null>;
}

// =====================================================================
// Video sourcing — a reference embed for motion/process concepts.
// =====================================================================

export type VideoSearchInput = {
  query: string;
};

export type SourcedVideo = {
  embedUrl: string;
  provider: string;
};

/**
 * A source of reference videos (e.g. a YouTube oEmbed lookup). Behind the same
 * testable mock/live pattern. The result is labelled an UNEVALUATED suggestion
 * in the UI (we do not vouch for third-party video content).
 */
export interface VideoSource {
  readonly providerName: string;
  resolve(input: VideoSearchInput): Promise<SourcedVideo | null>;
}

// =====================================================================
// Lesson-content visual extension — additive to LessonContent.
// =====================================================================

/** The visual needs a generated lesson may carry (Slice 4 extension). */
export type LessonVisuals = {
  visuals: VisualNeed[];
};

/** Context the gate/resolver may use (kept minimal + offline-friendly). */
export type VisualResolveContext = {
  assessment?: Competency[];
};
