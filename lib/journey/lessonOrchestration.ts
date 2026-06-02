/**
 * The code-owned lesson orchestrator: pure control flow over two injected ports,
 * an Author (Phase 1) and per-medium visual workers (Phase 2). Pipeline: author
 * sections/blocks, fan out one worker per visual block in parallel, drop any that
 * fail, assemble a complete LessonDoc. The caller serves a complete doc or the
 * progress/error screen, never a partial one.
 */

import {
  isVisualBlock,
  visualBlocks,
  type Block,
  type DraftLessonDoc,
  type LessonDoc,
  type Section,
  type VisualBlock,
} from "@/lib/services/lessonDoc";
import type { LessonContentInput } from "@/lib/services/lessonContent";
import type { ResolvedVisual, VisualMedium } from "@/lib/services/visualMedia";
import { mediumForKind } from "@/lib/services/visual/gate";
import {
  makeGenerationState,
  type GenerationStage,
  type LessonGenerationState,
} from "./lessonGenerationState";

/**
 * Phase 1 — turns the lesson context into ordered prose + visual specs. The
 * returned visual blocks carry { kind, spec } and nothing that can draw, so
 * ASCII art is structurally impossible. The orchestrator never inspects how the
 * doc was produced.
 */
export interface Author {
  author(input: LessonContentInput): Promise<DraftLessonDoc>;
}

/** What a Phase-2 worker receives: one visual block's intent. */
export type VisualWorkerInput = {
  id: string;
  kind: VisualBlock["kind"];
  spec: string;
};

/**
 * Phase 2 — one per medium. Turns one spec into one safe ResolvedVisual; retry
 * policy lives inside the worker. On terminal failure it throws or returns a
 * `none`-medium result, both of which the orchestrator drops. A worker must
 * NEVER return a broken/placeholder visual: dropped is acceptable, broken is not.
 */
export interface VisualWorker {
  resolve(input: VisualWorkerInput): Promise<ResolvedVisual>;
}

export type VisualWorkers = Record<VisualMedium, VisualWorker>;

/**
 * Best-effort progress sink: the caller persists the polled generation-state
 * record. A sink that throws must not abort generation.
 */
export type ProgressSink = (state: LessonGenerationState) => Promise<void> | void;

export type OrchestratorPorts = {
  author: Author;
  workers: VisualWorkers;
  onProgress?: ProgressSink;
};

const NOOP_SINK: ProgressSink = () => {};

async function emit(
  sink: ProgressSink,
  stage: GenerationStage,
  partial: { label?: string; done?: number; total?: number } = {},
): Promise<void> {
  try {
    await sink(makeGenerationState(stage, partial));
  } catch {
    // Progress is advisory; never let a sink failure abort generation.
  }
}

/**
 * Run the full pipeline for one goalpost and return the assembled LessonDoc.
 * Throws on a TERMINAL failure (e.g. the Author call fails) so the caller records
 * `status: "failed"`. Individual visual failures are NOT terminal: they drop
 * their slot and the lesson still completes (prose stands alone).
 */
export async function runLessonPipeline(
  input: LessonContentInput,
  ports: OrchestratorPorts,
): Promise<LessonDoc> {
  const sink = ports.onProgress ?? NOOP_SINK;

  await emit(sink, "authoring");
  const draft = await ports.author.author(input);

  const blocks = visualBlocks(draft);
  const total = blocks.length;
  await emit(sink, "composing", { done: 0, total });

  // Resolve in parallel; `done` advances as each settles so the polled progress
  // is honest about how many remain.
  let done = 0;
  const resolutions = await Promise.all(
    blocks.map(async (block) => {
      const resolved = await resolveOneVisual(block, ports.workers);
      done += 1;
      await emit(sink, "composing", { done, total });
      return { id: block.id, resolved };
    }),
  );
  const byId = new Map(resolutions.map((r) => [r.id, r.resolved]));

  await emit(sink, "assembling");
  return assemble(draft, byId);
}

/**
 * Resolve one visual block via the medium-appropriate worker, normalizing a
 * thrown error to a `none` result. The assemble step turns `none` into a drop.
 */
async function resolveOneVisual(
  block: VisualBlock,
  workers: VisualWorkers,
): Promise<ResolvedVisual> {
  const medium = mediumForKind(block.kind);
  const worker = workers[medium];
  try {
    return await worker.resolve({
      id: block.id,
      kind: block.kind,
      spec: block.spec,
    });
  } catch {
    return {
      medium: "none",
      id: block.id,
      caption: block.spec,
      reason: "visual_worker_error",
    };
  }
}

/**
 * Substitute resolved payloads into visual blocks, dropping any slot whose worker
 * produced no usable payload (missing, `none`, or still pending). Prose stands
 * alone, so a dropped visual leaves a complete lesson with no dangling reference.
 * Exported for unit testing against mock workers.
 */
export function assemble(
  draft: DraftLessonDoc,
  resolvedById: Map<string, ResolvedVisual>,
): LessonDoc {
  const sections: Section[] = draft.sections.map((section) => ({
    ...section,
    blocks: section.blocks.reduce<Block[]>((acc, block) => {
      if (!isVisualBlock(block)) {
        acc.push(block);
        return acc;
      }
      const resolved = resolvedById.get(block.id);
      if (!resolved || resolved.medium === "none") {
        return acc; // dropped
      }
      acc.push({
        ...block,
        status: "ready",
        payload: resolved,
      });
      return acc;
    }, []),
  }));

  return {
    sections,
    contentGeneratedAt: new Date().toISOString(),
  };
}
