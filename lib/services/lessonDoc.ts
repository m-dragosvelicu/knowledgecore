/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 1: Foundation).
 *
 * The information-step payload shape the redesign replaces { content, visuals }
 * with. See team/_pm/DECISIONS/2026-06-02-visual-pipeline-redesign.html §3.
 *
 * A LessonDoc is a CODE-OWNED, ORDERED container. The Author (Phase 1, Slice 2)
 * fills ONLY each prose block's `md` and each visual block's `spec`; the Phase-2
 * visual workers (Slice 3) fill each visual block's `payload`; the orchestrator
 * (this slice) owns the arrays and sets each visual block's `status`.
 *
 * The decisive property of the Author contract: a visual block carries a `spec`
 * (a rich DESCRIPTION of the picture) and a `kind`, but NO field through which a
 * drawn figure (e.g. svgSource) can be emitted. ASCII-art is therefore
 * STRUCTURALLY impossible at the Author stage, not merely forbidden. The drawn
 * payload only ever arrives later, from a dedicated Phase-2 worker, as a
 * ResolvedVisual.
 *
 * This is JSON in the SAME Step.payload column as the old shape, so there is NO
 * Prisma migration for the doc shape (redesign §3 / §10). It is ADDITIVE: it
 * lives alongside, and does not touch, the LOCKED lib/services/types.ts boundary.
 */

import type { ResolvedVisual, VisualKind } from "@/lib/services/visualMedia";

/** A self-contained markdown prose block. NO verbal visual references. */
export type ProseBlock = {
  type: "prose";
  /** Stable id within the lesson (assigned by the Author / orchestrator). */
  id: string;
  /** Markdown that reads complete even if a sibling visual is later dropped. */
  md: string;
};

/** Status of one visual slot across the pipeline. */
export type VisualBlockStatus = "pending" | "ready" | "dropped";

/**
 * A visual block. The Author emits { id, kind, spec } with status "pending" and
 * NO payload (it cannot draw). A Phase-2 worker either resolves it (payload set,
 * status "ready") or fails terminally (status "dropped", payload omitted). The
 * assemble stage omits dropped slots from the persisted doc, so a rendered
 * LessonDoc never carries a dropped block; the union keeps "dropped" only for
 * the in-flight orchestration value.
 */
export type VisualBlock = {
  type: "visual";
  /** Stable id within the lesson (for feedback wiring + worker correlation). */
  id: string;
  /** The closed visualKind the gate routes on (svg | image | video medium). */
  kind: VisualKind;
  /**
   * The Phase-1 Author's rich description of what the picture must show: the
   * intent, labels, values. This is the WORKER INPUT, never a drawn figure.
   */
  spec: string;
  /** Orchestrator-owned lifecycle marker. */
  status: VisualBlockStatus;
  /** The resolved, safe-to-render visual once a worker succeeds (status "ready"). */
  payload?: ResolvedVisual;
};

export type Block = ProseBlock | VisualBlock;

/** One section of the lesson: a heading plus its ordered blocks. */
export type Section = {
  id: string;
  heading: string;
  blocks: Block[];
};

/**
 * The whole information-step lesson. Persisted to Step.payload as JSON. The
 * renderer (Slice 4) walks sections -> blocks; `contentGeneratedAt` is the
 * idempotency / freshness marker (same role as the old InfoPayload field).
 */
export type LessonDoc = {
  sections: Section[];
  contentGeneratedAt: string;
};

/** A LessonDoc still mid-flight (visual blocks may be pending/dropped). */
export type DraftLessonDoc = {
  sections: Section[];
};

// =====================================================================
// Type guards / helpers — used by the orchestrator (assemble) and the renderer.
// =====================================================================

export function isVisualBlock(block: Block): block is VisualBlock {
  return block.type === "visual";
}

export function isProseBlock(block: Block): block is ProseBlock {
  return block.type === "prose";
}

/** Narrow check used by the goalpost page: is this payload a new-shape LessonDoc? */
export function isLessonDoc(payload: unknown): payload is LessonDoc {
  return (
    !!payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { sections?: unknown }).sections) &&
    typeof (payload as { contentGeneratedAt?: unknown }).contentGeneratedAt ===
      "string"
  );
}

/** Every visual block across all sections, in document order. */
export function visualBlocks(doc: DraftLessonDoc): VisualBlock[] {
  const out: VisualBlock[] = [];
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (isVisualBlock(block)) out.push(block);
    }
  }
  return out;
}
