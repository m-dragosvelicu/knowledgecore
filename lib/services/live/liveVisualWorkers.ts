// Phase-2 visual workers: each turns ONE Phase-1 spec into ONE safe visual, retrying
// hard, then on terminal failure returns a `none`-medium ResolvedVisual so the slot is
// DROPPED. Never a broken/placeholder visual: dropped is acceptable, broken is not (§7).

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

// Stable, cacheable SVG-authoring prefix; the per-visual spec is the user-message tail.
// The prompt names the sanitizer's allowed element/attribute envelope so the model's
// first attempt already sits inside the allowlist (fewer stripped nodes).
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

// Non-degenerate bar: enough bytes AND at least one real shape/text element, so a
// surviving-but-empty <svg></svg> is treated as junk (retried, then dropped).
const MIN_SVG_BYTES = 120;
const DRAWING_ELEMENT_RE = /<(path|rect|circle|ellipse|line|polyline|polygon|text)[\s>/]/i;
const SVG_MAX_ATTEMPTS = 3;

type SvgQuality = { usable: boolean; reason: string };

// Pure + exported for the verify script. sanitizeSvg already guarantees safety + an
// <svg> root when ok; this only adds the non-degenerate bar.
export function judgeSanitizedSvg(svg: string, ok: boolean): SvgQuality {
  if (!ok || !svg) return { usable: false, reason: "empty_or_unsafe" };
  if (svg.length < MIN_SVG_BYTES) return { usable: false, reason: "too_small" };
  if (!DRAWING_ELEMENT_RE.test(svg)) return { usable: false, reason: "no_drawing_element" };
  return { usable: true, reason: "ok" };
}

/** Strip code fences / leading-trailing junk so only the <svg>...</svg> survives. */
function extractSvgMarkup(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").trim();
  const start = s.search(/<svg[\s>]/i);
  if (start === -1) return "";
  const endIdx = s.toLowerCase().lastIndexOf("</svg>");
  if (endIdx === -1) return "";
  s = s.slice(start, endIdx + "</svg>".length);
  return s;
}

// Plain TEXT completion (not structured): structured would force thinkingBudget=0 and
// add fragile JSON escaping of a large SVG blob; the plain path lets the model lay out
// geometry and absorb hidden thinking tokens under a generous maxTokens (redesign §14).
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
          // Generous ceiling, not a tuned limit (hidden thinking shares the budget).
          maxTokens: 16384,
          temperature: 0.4,
        });
        raw = res.text ?? "";
      } catch {
        continue;
      }

      const markup = extractSvgMarkup(raw);
      if (!markup) continue;

      // SAFETY BOUNDARY: sanitize on the dedicated SVG path ONLY, never the markdown
      // sanitizer. The worker returns sanitizer OUTPUT, never raw markup.
      const { svg, ok } = sanitizeSvg(markup);
      const quality = judgeSanitizedSvg(svg, ok);
      if (!quality.usable) continue;

      return {
        medium: "svg",
        id: input.id,
        svg,
        caption: input.spec,
      };
    }

    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "svg_unrenderable_after_retries",
    };
  }
}

// The spec is an illustrator DESCRIPTION, not a search string, so derive a tight
// few-word subject: first clause, strip meta-instruction phrasing and trailing intent,
// cap the length. Pure + exported for the verify script.
export function deriveImageQuery(spec: string): string {
  let s = (spec ?? "").trim();
  if (!s) return "";
  s = s.split(/[.\n;:]/)[0] ?? s;
  s = s.replace(
    /^\s*(an?|the)?\s*(close[- ]up|wide[- ]angle|aerial|macro|detailed|labelled|realistic|high[- ]resolution)?\s*(photo(graph)?|image|picture|illustration|photo(graph)?ic depiction|depiction|scene|shot|view)\s*(of|showing|depicting|that shows|capturing)?\s*/i,
    "",
  );
  s = s.split(/\b(showing|so that|to illustrate|to show|which|that|highlighting|demonstrating)\b/i)[0] ?? s;
  s = s.replace(/[,"']/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(Boolean).slice(0, 8);
  return words.join(" ");
}

export class ImageWorker implements VisualWorker {
  constructor(private readonly imageSource: ImageSource) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    // Tightened subject first; the raw spec head as a fallback if it over-trimmed.
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
        continue;
      }
      if (!sourced || !sourced.url) continue;
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

// If the spec already embeds a YouTube URL / 11-char id, return it for direct
// resolution; otherwise "" and the worker falls through to the model-assisted
// candidate step. Pure + exported for the verify script.
export function deriveVideoQuery(spec: string): string {
  const s = (spec ?? "").trim();
  if (!s) return "";
  const urlMatch = s.match(
    /(https?:\/\/[^\s]*(?:youtu\.be|youtube(?:-nocookie)?\.com)[^\s]*)/i,
  );
  if (urlMatch) return urlMatch[1];
  const bareId = s.match(/\b([a-zA-Z0-9_-]{11})\b/);
  if (bareId && /[A-Z]/i.test(bareId[1]) && /\d|_|-/.test(bareId[1])) {
    return bareId[1];
  }
  return "";
}

// Stable, cacheable prefix; the per-visual spec is the user-message tail. The answer
// is UNTRUSTED: a hallucinated/dead id is caught by the downstream oEmbed validator.
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

const VIDEO_MAX_ATTEMPTS = 3;
const VIDEO_TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

type VideoCandidate = { videoId: string; title: string; confident: boolean };

// Lenient JSON parse (strip stray fences/prose). null when there is no usable
// candidate. Shape-only: existence/embeddability is confirmed later by the source.
// Pure + exported for the verify script.
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

// Honours an id/URL already in the spec first; otherwise proposes a candidate via the
// model and VALIDATES it through the keyless oEmbed source. Any unvalidatable id is
// dropped, never surfaced broken. The embed is a privacy-friendly youtube-nocookie URL.
export class VideoWorker implements VisualWorker {
  constructor(
    private readonly videoSource: VideoSource,
    private readonly llm?: LLMClient,
  ) {}

  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    const direct = deriveVideoQuery(input.spec);
    if (direct) {
      const resolved = await this.tryValidate(direct, input);
      if (resolved) return resolved;
    }

    // Ask the model for a candidate, then validate the UNTRUSTED id through the
    // source before surfacing it. Retry-then-drop.
    if (this.llm) {
      for (let attempt = 1; attempt <= VIDEO_MAX_ATTEMPTS; attempt++) {
        const candidate = await this.proposeCandidate(input.spec, input.kind);
        if (!candidate) continue;
        const resolved = await this.tryValidate(candidate.videoId, input);
        if (resolved) return resolved;
      }
    }

    return {
      medium: "none",
      id: input.id,
      caption: input.spec,
      reason: "no_reference_video",
    };
  }

  // Plain TEXT completion (not structured): structured pins thinkingBudget=0, but
  // recalling a real video benefits from the model reasoning, so we let it think and
  // parse the small JSON ourselves. Best-effort telemetry; returns null on error/decline.
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
        // Generous ceiling, not a tuned limit (hidden thinking shares the budget).
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
      return null;
    }
  }

  // Validate a candidate id/URL through the keyless oEmbed source; null on any miss
  // (dead/private/non-embeddable/source error) so the caller retries or drops. Never
  // returns a broken embed.
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
      // source error -> treat as a miss
    }
    return null;
  }

  // Best-effort telemetry; never breaks resolution.
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

// The per-medium worker set the orchestrator fans out to.
export function buildVisualWorkers(deps: {
  llm: LLMClient;
  imageSource: ImageSource;
  videoSource: VideoSource;
}): VisualWorkers {
  return {
    svg: new SvgWorker(deps.llm),
    image: new ImageWorker(deps.imageSource),
    video: new VideoWorker(deps.videoSource, deps.llm),
  };
}
