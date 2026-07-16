/**
 * The information-step payload contract: a code-owned, ordered LessonDoc. The
 * Author (Phase 1) fills prose `md` and visual `spec`; Phase-2 workers fill
 * each visual block's `payload`; the orchestrator owns the arrays and `status`.
 * A visual block has no field that can emit a drawn figure, so ASCII art is
 * structurally impossible at the Author stage. Persisted as JSON in
 * Step.payload — no Prisma migration for this shape.
 */

import type { ResolvedVisual, VisualKind } from "@/lib/services/visualMedia";

/** A self-contained markdown prose block; reads complete if a sibling visual drops. */
export type ProseBlock = {
  type: "prose";
  id: string;
  md: string;
};

export type VisualBlockStatus = "pending" | "ready" | "dropped";

/**
 * The Author emits { id, kind, spec } as "pending" with no payload (it cannot
 * draw). A Phase-2 worker resolves it (payload, "ready") or fails ("dropped").
 * Assemble omits dropped slots, so a persisted doc never carries one; "dropped"
 * exists only for the in-flight orchestration value.
 */
export type VisualBlock = {
  type: "visual";
  id: string;
  /** The closed visualKind the gate routes on (svg | image | video medium). */
  kind: VisualKind;
  /** The Author's description of what the picture must show: the worker input. */
  spec: string;
  status: VisualBlockStatus;
  payload?: ResolvedVisual;
};

export type Block = ProseBlock | VisualBlock;

export type Section = {
  id: string;
  heading: string;
  blocks: Block[];
};

/** The whole information-step lesson. `contentGeneratedAt` is the freshness marker. */
export type LessonDoc = {
  sections: Section[];
  contentGeneratedAt: string;
};

/** A LessonDoc still mid-flight (visual blocks may be pending/dropped). */
export type DraftLessonDoc = {
  sections: Section[];
};

export function isVisualBlock(block: Block): block is VisualBlock {
  return block.type === "visual";
}

export function isProseBlock(block: Block): block is ProseBlock {
  return block.type === "prose";
}

/** Is this payload a LessonDoc? Used by the goalpost page to branch the render. */
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
