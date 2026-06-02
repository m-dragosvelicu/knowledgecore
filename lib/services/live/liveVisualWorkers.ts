/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 3): the REAL Phase-2 visual workers.
 *
 * Each worker turns ONE Phase-1 visual SPEC into ONE rendered, SAFE visual with
 * full, dedicated attention, then enforces the §7 failure policy:
 *
 *   RETRY HARD INSIDE resolve(); on TERMINAL failure return a `none`-medium
 *   ResolvedVisual so the orchestrator DROPS the slot. NEVER return a broken or
 *   placeholder svg|image|video. "Dropped is acceptable; broken is not."
 *
 * Three workers, one job each (redesign §7 routing):
 *   - SvgWorker   (diagram | structural | quantitative): a DEDICATED focused model
 *     call whose ENTIRE output is one clean SVG, then sanitizeSvg() on the SVG-only
 *     security path, then a degenerate-output check; retry on junk/empty, then drop.
 *   - ImageWorker (photographic | real_world | human | situational): Openverse
 *     license-clean search with a query DERIVED from the rich spec + a fallback
 *     query before dropping.
 *   - VideoWorker (process | motion): a model-assisted CANDIDATE step — a focused
 *     Gemini call proposes a known reference video id for the spec, which is then
 *     VALIDATED through the existing keyless source (oEmbed existence/embed check).
 *     A hallucinated/dead/non-embeddable id fails validation and is dropped, never
 *     surfaced broken. Retry a small N, then drop. The embed is youtube-nocookie and
 *     is labelled an unevaluated suggestion (we do not vouch for third-party video).
 *
 * SAFETY BOUNDARY: the generated SVG is UNTRUSTED CODE. It is sanitized ONLY on the
 * dedicated sanitizeSvg() path (lib/services/visual/svgSanitizer.ts) and NEVER goes
 * through the lesson-text markdown sanitizer. The worker returns sanitizer OUTPUT.
 */

import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
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
import { sanitizeSvg } from "@/lib/services/visual/svgSanitizer";

// =====================================================================
// SVG worker — the dedicated focused SVG authoring call.
// =====================================================================

/**
 * The SVG model is given the spec and asked to return ONE clean SVG and nothing
 * else. These are the Visualization-Engineer authoring-quality conventions baked
 * into the prompt: self-contained (no external fonts/images/scripts), legible
 * labels that match the spec's values/structure, restrained consistent style,
 * sensible viewBox + spacing. The output is then put through sanitizeSvg() — the
 * model is told the allowed element/attribute envelope so its first attempt is
 * already inside the sanitizer's allowlist (fewer stripped nodes -> cleaner result).
 *
 * Kept as the STABLE, cacheable system prefix; the per-visual spec is the user
 * message tail (cacheKey below).
 */
const SVG_SYSTEM = `You are an SVG illustrator for a learning platform. You are given
a DESCRIPTION of one diagram and you return ONE clean, self-contained SVG that renders
that diagram. Your ENTIRE output is the SVG and nothing else.

OUTPUT FORMAT — STRICT.
- Output ONLY the SVG markup, starting with "<svg" and ending with "</svg>".
- No prose, no explanation, no markdown, NO code fences (no \`\`\`), before or after.

SELF-CONTAINED + SAFE. The SVG is rendered inline in a browser, so it must be fully
self-contained and carry no active or external content:
- NO <script>, NO event handlers (onload, onclick, ... — none at all).
- NO <foreignObject>, NO <image>, NO <use>, NO <iframe>, NO <a>, NO external <style>.
- NO external references of any kind: no href/xlink:href, no src, no url(...), no
  remote fonts. Use ONLY generic font families already on the system, e.g.
  font-family="sans-serif".
- Use ONLY these elements: svg, g, defs, title, desc, path, rect, circle, ellipse,
  line, polyline, polygon, text, tspan, marker, linearGradient, radialGradient, stop,
  clipPath. Anything else will be stripped, so do not rely on it.
- Draw with presentation attributes (fill, stroke, stroke-width, opacity, transform,
  text-anchor, font-size, font-family, ...) or a simple inline style limited to those
  same properties. Use markers for arrowheads (define a <marker> in <defs> and
  reference it with marker-end).

QUALITY — make it legible and restrained.
- Set a sensible viewBox and lay the figure out WITHIN it with generous padding; never
  let shapes or text touch or overflow the edges, and never let labels overlap shapes.
- Reproduce EVERY label, value, node, edge, and axis the description names, spelled
  exactly as given. The diagram must match the description's structure and values.
- Readable type: font-size around 12-18 user units; high-contrast text (dark text on a
  light background); center or anchor labels deliberately (text-anchor / dominant
  semantics) so they sit cleanly on their shapes.
- A restrained, consistent palette (a small number of muted colors); consistent stroke
  widths; even spacing between repeated elements. Calm and schematic, not decorative.
- Prefer a viewBox in the rough range of 0 0 640 400 to 0 0 800 600 unless the content
  clearly needs another aspect ratio.

Return the single best SVG for the description. Output the SVG now.`;

/**
 * Lower bound on a non-degenerate SVG. A sanitized result that survives but is a
 * near-empty <svg></svg> (or a couple of stray attributes) is junk; require both a
 * minimum byte length AND at least one real drawing/text element so an empty or
 * trivially-degenerate output is retried, then dropped.
 */
const MIN_SVG_BYTES = 120;
const DRAWING_ELEMENT_RE = /<(path|rect|circle|ellipse|line|polyline|polygon|text)[\s>/]/i;

/** A small number of retries for the focused SVG call (redesign §7). */
const SVG_MAX_ATTEMPTS = 3;

type SvgQuality = { usable: boolean; reason: string };

/**
 * Judge a SANITIZED SVG. `sanitizeSvg` already guarantees safety and an <svg> root
 * when ok; here we add the non-degenerate bar: enough bytes AND at least one real
 * shape/text element. Pure + exported for the verify script.
 */
export function judgeSanitizedSvg(svg: string, ok: boolean): SvgQuality {
  if (!ok || !svg) return { usable: false, reason: "empty_or_unsafe" };
  if (svg.length < MIN_SVG_BYTES) return { usable: false, reason: "too_small" };
  if (!DRAWING_ELEMENT_RE.test(svg)) return { usable: false, reason: "no_drawing_element" };
  return { usable: true, reason: "ok" };
}

/** Strip code fences / leading-trailing junk so only the <svg>...</svg> survives. */
function extractSvgMarkup(raw: string): string {
  if (!raw) return "";
  // Drop markdown code fences if the model wrapped the SVG despite instructions.
  let s = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").trim();
  const start = s.search(/<svg[\s>]/i);
  if (start === -1) return "";
  const endIdx = s.toLowerCase().lastIndexOf("</svg>");
  if (endIdx === -1) return "";
  s = s.slice(start, endIdx + "</svg>".length);
  return s;
}

/**
 * The dedicated SVG worker. ONE focused model call per attempt, full attention on
 * one picture. Plain TEXT completion (not structured): the entire output is the SVG,
 * so wrapping it in a JSON string would only add fragile escaping of a large code
 * blob and force thinkingBudget=0; the plain path lets the model lay out geometry
 * and absorbs hidden thinking tokens under a generous maxTokens (redesign §14).
 */
export class SvgWorker implements VisualWorker {
  constructor(private readonly llm: LLMClient) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    for (let attempt = 1; attempt <= SVG_MAX_ATTEMPTS; attempt++) {
      let raw: string;
      try {
        const res = await this.llm.complete({
          system: SVG_SYSTEM,
          cacheKey: "svg_worker_system_v1",
          messages: [
            {
              role: "user",
              content:
                `Diagram to draw (kind: ${input.kind}):\n${input.spec}\n\n` +
                `Output ONE self-contained SVG that renders exactly this. ` +
                `SVG only, starting with <svg and ending with </svg>.`,
            },
          ],
          // Generous ceiling, NOT a tuned limit. gemini-3.5-flash is a thinking
          // model whose hidden thinking tokens draw from the same budget (redesign
          // §14); a high ceiling removes truncation risk and we are billed for
          // actual output, not the cap. Do not tune tight from visible-token counts.
          maxTokens: 16384,
          temperature: 0.4,
        });
        raw = res.text ?? "";
      } catch {
        // Transient model/network error on this attempt -> retry (then drop).
        continue;
      }

      const markup = extractSvgMarkup(raw);
      if (!markup) continue; // no SVG in the output -> retry

      // SAFETY BOUNDARY: sanitize on the DEDICATED SVG path ONLY. Never the
      // markdown sanitizer. The worker returns sanitizer OUTPUT, never raw markup.
      const { svg, ok } = sanitizeSvg(markup);
      const quality = judgeSanitizedSvg(svg, ok);
      if (!quality.usable) continue; // junk/empty/degenerate -> retry

      return {
        medium: "svg",
        id: input.id,
        svg,
        // The spec doubles as the caption / alt text for the rendered figure.
        caption: input.spec,
      };
    }

    // Retried hard and still could not produce a clean, non-degenerate SVG -> DROP.
    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "svg_unrenderable_after_retries",
    };
  }
}

// =====================================================================
// Image worker — Openverse license-clean search, spec -> query.
// =====================================================================

/**
 * Derive a tight SEARCH QUERY from the rich spec. The spec is a DESCRIPTION written
 * for an illustrator ("A close-up photograph of a honeybee on a sunflower, showing
 * the pollen on its legs"), not a search string. Photo search engines want the
 * concrete subject in a few words, so we take the first descriptive clause, strip
 * meta-instruction words ("photograph of", "image showing", "close-up of"), drop
 * trailing intent clauses, and cap the length. Pure + exported for the verify script.
 */
export function deriveImageQuery(spec: string): string {
  let s = (spec ?? "").trim();
  if (!s) return "";
  // First sentence / clause only — the searchable subject lives up front.
  s = s.split(/[.\n;:]/)[0] ?? s;
  // Strip leading meta-instruction phrasing the spec uses to address the renderer.
  s = s.replace(
    /^\s*(an?|the)?\s*(close[- ]up|wide[- ]angle|aerial|macro|detailed|labelled|realistic|high[- ]resolution)?\s*(photo(graph)?|image|picture|illustration|photo(graph)?ic depiction|depiction|scene|shot|view)\s*(of|showing|depicting|that shows|capturing)?\s*/i,
    "",
  );
  // Drop a trailing intent/purpose clause that hurts photo recall.
  s = s.split(/\b(showing|so that|to illustrate|to show|which|that|highlighting|demonstrating)\b/i)[0] ?? s;
  s = s.replace(/[,"']/g, " ").replace(/\s+/g, " ").trim();
  // Keep it short — a handful of words searches far better than a paragraph.
  const words = s.split(" ").filter(Boolean).slice(0, 8);
  return words.join(" ");
}

export class ImageWorker implements VisualWorker {
  constructor(private readonly imageSource: ImageSource) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    // Primary query: the tightened subject. Fallback: the raw spec head, in case
    // the derivation over-trimmed and the verbose form happens to match.
    const primary = deriveImageQuery(input.spec);
    const fallback = (input.spec ?? "").trim().split(/[.\n]/)[0]?.trim() ?? "";
    const queries = [primary, fallback].filter(
      (q, i, arr) => q.length > 0 && arr.indexOf(q) === i,
    );

    for (const query of queries) {
      let sourced;
      try {
        sourced = await this.imageSource.search({ query, safeSearch: true });
      } catch {
        continue; // source error on this query -> try the fallback, then drop
      }
      if (!sourced || !sourced.url) continue;

      // Light quality bar: require a usable http(s) URL. Attribution is taken
      // VERBATIM from the source (never fabricated); a missing creator/license is
      // surfaced as reported, not invented.
      if (!/^https?:\/\//i.test(sourced.url)) continue;

      return {
        medium: "image",
        id: input.id,
        url: sourced.url,
        caption: input.spec,
        attribution: sourced.attribution,
      };
    }

    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "no_license_clean_image",
    };
  }
}

// =====================================================================
// Video worker — model-assisted candidate, then VALIDATE through the source.
// =====================================================================

/**
 * Derive the video query from the spec. The LIVE YouTube source resolves a concrete
 * watch URL / 11-char video id (full search-ranking is out of L1 scope, per
 * liveYouTubeVideoSource): if the spec ALREADY embeds such an id/URL we pass it
 * straight through; otherwise we return "" and the worker falls through to the
 * model-assisted candidate step. Pure + exported for the verify script.
 */
export function deriveVideoQuery(spec: string): string {
  const s = (spec ?? "").trim();
  if (!s) return "";
  // Prefer an explicit YouTube URL / id embedded in the spec (what the source can
  // resolve directly). Match common shapes without executing anything.
  const urlMatch = s.match(
    /(https?:\/\/[^\s]*(?:youtu\.be|youtube(?:-nocookie)?\.com)[^\s]*)/i,
  );
  if (urlMatch) return urlMatch[1];
  const bareId = s.match(/\b([a-zA-Z0-9_-]{11})\b/);
  if (bareId && /[A-Z]/i.test(bareId[1]) && /\d|_|-/.test(bareId[1])) {
    return bareId[1];
  }
  // No concrete reference in the spec -> no direct query; the worker will ask the
  // model to PROPOSE a candidate, then validate it through the source.
  return "";
}

/**
 * The candidate prompt. The model knows many canonical educational YouTube videos;
 * we ask it to NAME one well-known, still-online reference video for the process /
 * motion concept the spec describes and return its concrete watch URL or id. We do
 * NOT trust this answer — a hallucinated or dead id is caught by the validator
 * below (the keyless oEmbed check) and the candidate is dropped. The prompt is the
 * STABLE, cacheable system prefix; the per-visual spec is the user-message tail.
 */
const VIDEO_CANDIDATE_SYSTEM = `You are a reference-video librarian for a learning
platform. You are given a DESCRIPTION of one process- or motion-type concept that is
best shown as a short moving reference. Your job is to NAME one specific, well-known
educational YouTube video that clearly demonstrates that concept, and return the
concrete reference to it.

OUTPUT FORMAT — STRICT. Output ONLY a single minified JSON object and nothing else
(no prose, no markdown, no code fences):
{"videoId":"<the 11-character YouTube video id>","title":"<the video's title as you
recall it>","confident":<true|false>}

RULES.
- "videoId" MUST be the canonical 11-character YouTube id (the value after "watch?v="
  or "youtu.be/"), e.g. "dQw4w9WgXcQ". Not a URL, not a channel, not a playlist.
- Name a video you ACTUALLY recall existing on YouTube and that directly shows THIS
  concept. Prefer a stable, popular, long-lived educational channel (a video far less
  likely to have been removed).
- Do NOT invent an id to satisfy the format. If you do not genuinely recall a real
  video for this concept, set "confident" to false and "videoId" to an empty string.
  A clean "no candidate" is correct and expected; a fabricated id is not — it will be
  rejected by a downstream existence check anyway.
- Return ONLY the JSON object.`;

/** A small number of candidate attempts before dropping the slot (redesign §7). */
const VIDEO_MAX_ATTEMPTS = 3;
const VIDEO_TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

type VideoCandidate = { videoId: string; title: string; confident: boolean };

/**
 * Parse the model's candidate JSON leniently: strip any stray fences/prose and read
 * the first JSON object. Returns null when there is no usable candidate (the model
 * declined, returned junk, or an empty/false answer). Pure + exported for the verify
 * script. The returned videoId is NOT validated here — only shape-parsed; existence /
 * embeddability is confirmed separately by the source.
 */
export function parseVideoCandidate(raw: string): VideoCandidate | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const videoId = typeof rec.videoId === "string" ? rec.videoId.trim() : "";
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  const confident = rec.confident === true;
  // The model declined (empty id or not confident) -> no candidate this attempt.
  if (!videoId || !confident) return null;
  return { videoId, title, confident };
}

type VideoTelemetry = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/**
 * The video worker. For a process/motion spec it first honours an id/URL ALREADY in
 * the spec (validated through the source). Otherwise it runs the model-assisted
 * candidate step: a focused Gemini call PROPOSES a known reference video id, which is
 * then VALIDATED through the EXISTING source (the keyless oEmbed existence/embed
 * check). A hallucinated, removed, private, or non-embeddable id fails that check, so
 * it is DROPPED — never surfaced broken. Retry a small number of times, then return
 * `none` (the slot drops, exactly as before). The embed is a privacy-friendly
 * youtube-nocookie URL, surfaced as an UNEVALUATED suggestion downstream.
 */
export class VideoWorker implements VisualWorker {
  constructor(
    private readonly videoSource: VideoSource,
    private readonly llm?: LLMClient,
  ) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    // 1) If the spec already names a concrete YouTube id/URL, validate it directly.
    const direct = deriveVideoQuery(input.spec);
    if (direct) {
      const resolved = await this.tryValidate(direct, input);
      if (resolved) return resolved;
    }

    // 2) Otherwise ask the model for a candidate, then validate it. Retry-then-drop.
    if (this.llm) {
      for (let attempt = 1; attempt <= VIDEO_MAX_ATTEMPTS; attempt++) {
        const candidate = await this.proposeCandidate(input.spec, input.kind);
        if (!candidate) continue; // model declined / junk this attempt -> retry
        // VALIDATION: the candidate is UNTRUSTED. Confirm it exists + embeds via the
        // existing source before we ever surface it. A hallucinated/dead id fails
        // here and we retry, then drop.
        const resolved = await this.tryValidate(candidate.videoId, input);
        if (resolved) return resolved;
      }
    }

    // No spec id and no validating candidate -> drop the slot honestly.
    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "no_reference_video",
    };
  }

  /**
   * Run the candidate proposal call. Plain TEXT completion (not structured): a
   * structured call pins thinkingBudget=0 (per the Gemini client), but recalling a
   * canonical video benefits from the model reasoning over what actually exists, so
   * we let it think under a generous ceiling and parse the small JSON ourselves —
   * the same plain-path rationale as the SVG worker. Records a best-effort telemetry
   * row (reused `visual_generate` purpose — this is a visual-generation assist call).
   * Returns the parsed candidate or null (transient error / decline / junk).
   */
  private async proposeCandidate(
    spec: string,
    kind: VisualWorkerInput["kind"],
  ): Promise<VideoCandidate | null> {
    if (!this.llm) return null;
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    try {
      const res = await this.llm.complete({
        system: VIDEO_CANDIDATE_SYSTEM,
        cacheKey: "video_candidate_system_v1",
        messages: [
          {
            role: "user",
            content:
              `Concept to demonstrate (kind: ${kind}):\n${spec}\n\n` +
              `Name ONE well-known, still-online educational YouTube video that ` +
              `clearly shows this. Return ONLY the JSON object.`,
          },
        ],
        // Generous ceiling, NOT a tuned limit: gemini-3.5-flash is a thinking model
        // whose hidden thinking tokens draw from the same budget, and we are billed
        // for actual output, so a high ceiling only removes truncation risk.
        maxTokens: 4096,
        temperature: 0.5,
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: true,
        errorMessage: null,
        usage,
        model: usageModel,
      });
      return parseVideoCandidate(res.text ?? "");
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage,
        model: usageModel,
      });
      return null; // transient model/network error -> treat as no candidate, retry
    }
  }

  /**
   * Validate a candidate id/URL through the EXISTING source (keyless oEmbed). On a
   * confirmed, embeddable result returns the ResolvedVideo; on any miss (dead id,
   * private/removed, non-embeddable, source error) returns null so the caller retries
   * or drops. NEVER returns a broken embed.
   */
  private async tryValidate(
    query: string,
    input: VisualWorkerInput,
  ): Promise<ResolvedVisual | null> {
    try {
      const video = await this.videoSource.resolve({ query });
      if (video && /^https?:\/\//i.test(video.embedUrl)) {
        return {
          medium: "video",
          id: input.id,
          embedUrl: video.embedUrl,
          caption: input.spec,
          provider: video.provider,
        };
      }
    } catch {
      // source error -> treat as a miss (caller retries / drops)
    }
    return null;
  }

  /** Best-effort telemetry for the candidate call; never breaks resolution. */
  private async recordLlmCall(snapshot: VideoTelemetry): Promise<void> {
    try {
      const model = snapshot.model ?? VIDEO_TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "visual_generate",
          model,
          inputTokens,
          outputTokens,
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist visual_generate (video candidate) row: ${
          (err as Error).message
        }`,
      );
    }
  }
}

// =====================================================================
// Assembly — the REAL per-medium worker set for the live path.
// =====================================================================

/**
 * Assemble the per-medium worker set the orchestrator fans out to. The SVG worker
 * needs the LLM client (it authors); the image/video workers need their license-clean
 * sources. Mirrors buildVisualWorkerStubs so it is a drop-in at the swap point.
 */
export function buildVisualWorkers(deps: {
  llm: LLMClient;
  imageSource: ImageSource;
  videoSource: VideoSource;
}): VisualWorkers {
  return {
    svg: new SvgWorker(deps.llm),
    image: new ImageWorker(deps.imageSource),
    // The video worker uses the SAME shared LLM client for the model-assisted
    // candidate step (propose a known reference id, then validate via the source).
    video: new VideoWorker(deps.videoSource, deps.llm),
  };
}
