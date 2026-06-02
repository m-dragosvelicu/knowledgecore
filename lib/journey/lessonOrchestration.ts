/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 1: Foundation).
 *
 * The CODE-OWNED orchestrator. It owns the container and the control flow; the
 * AI only fills content within the fixed structure (redesign §2/§4/§5). This
 * module is PURE CONTROL FLOW — it contains NO model logic. Phase 1 (the Author)
 * and Phase 2 (the visual workers) are injected as PORTS so the later slices plug
 * concrete implementations in without touching this file:
 *
 *   - Author port            -> Slice 2 (AI Engineer): the no-draw Phase-1 call.
 *   - VisualWorker port(s)    -> Slice 3 (AI + Visualization): per-medium workers.
 *
 * THE §5 PIPELINE this skeleton implements:
 *   1. AUTHOR        one Author call -> sections/blocks (prose md + visual specs)
 *   2. FAN OUT       for each visual block, spawn a worker IN PARALLEL
 *   3. RESOLVE/RETRY each worker retries hard; success -> payload+ready,
 *                    terminal failure -> dropped
 *   4. ASSEMBLE      substitute payloads, DROP dropped slots, set contentGeneratedAt
 *   5. (persist + progress events are emitted at each stage via a sink)
 *
 * Reveal invariant: the caller persists/serves a COMPLETE LessonDoc or shows the
 * progress/error screen — never a partial doc, never a placeholder visual. The
 * assemble stage guarantees no dropped slot or dangling reference survives.
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

// =====================================================================
// PORTS — the handoff contract Slices 2 & 3 implement.
// =====================================================================

/**
 * PHASE 1 — the Author port. OWNED BY SLICE 2 (AI Engineer).
 *
 * Turns the lesson context into an ordered structure of prose blocks + visual
 * SPECS. The returned blocks carry, per visual: { kind, spec } and NOTHING that
 * can draw (no svgSource) — that is the structural no-ASCII guarantee. The
 * orchestrator assigns/keeps block ids and stamps every visual block `pending`
 * with no payload, so an Author that returns ids may have them normalized here.
 *
 * Slice 2 implements `author(input)` as one structured (no-draw schema) model
 * call and returns a DraftLessonDoc whose visual blocks are all `status:
 * "pending"`. The orchestrator NEVER inspects how the doc was produced.
 */
export interface Author {
  author(input: LessonContentInput): Promise<DraftLessonDoc>;
}

/** What a Phase-2 worker receives: one visual block's intent. */
export type VisualWorkerInput = {
  /** The visual block id (correlation + the ResolvedVisual id). */
  id: string;
  /** The closed visualKind (the worker may assert its medium matches). */
  kind: VisualBlock["kind"];
  /** The Phase-1 Author's rich description of what the picture must show. */
  spec: string;
};

/**
 * PHASE 2 — a visual worker port, one per medium. OWNED BY SLICE 3 (AI +
 * Visualization Engineer).
 *
 * Turns ONE spec into ONE rendered, SAFE ResolvedVisual with dedicated attention:
 *   - the SVG worker authors clean SVG then sanitizes it (the existing safe path),
 *   - the image/video workers search the existing license-clean sources.
 *
 * RETRY POLICY lives INSIDE the worker (redesign §7: "retry hard"): `resolve`
 * must return a renderable ResolvedVisual (medium svg|image|video) on success, or
 * a `none`-medium ResolvedVisual / throw on TERMINAL failure. The orchestrator
 * treats BOTH a thrown error and a `none` result as "drop this slot" — so a
 * worker may signal terminal failure either way. A worker must NEVER return a
 * broken/placeholder svg|image|video; "dropped is acceptable, broken is not".
 */
export interface VisualWorker {
  resolve(input: VisualWorkerInput): Promise<ResolvedVisual>;
}

/** The three medium workers the orchestrator fans out to, keyed by medium. */
export type VisualWorkers = Record<VisualMedium, VisualWorker>;

/**
 * Progress sink — the orchestrator calls this at each stage so the caller can
 * persist the generation-state record the client polls (§8). Best-effort by
 * contract: a sink that throws must not abort generation (the caller's wrapper
 * swallows sink errors).
 */
export type ProgressSink = (state: LessonGenerationState) => Promise<void> | void;

export type OrchestratorPorts = {
  author: Author;
  workers: VisualWorkers;
  /** Optional progress sink; defaults to a no-op when omitted (e.g. in tests). */
  onProgress?: ProgressSink;
};

// =====================================================================
// Orchestrator — pure control flow over the ports.
// =====================================================================

/** Number of times the ASSEMBLE step tolerates a worker drop and continues. */
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
 * Throws on a TERMINAL failure (e.g. the Author call fails) so the caller can
 * record `status: "failed"` instead of silently swallowing. Individual visual
 * failures are NOT terminal — they drop their slot and the lesson still
 * completes (prose stands alone).
 */
export async function runLessonPipeline(
  input: LessonContentInput,
  ports: OrchestratorPorts,
): Promise<LessonDoc> {
  const sink = ports.onProgress ?? NOOP_SINK;

  // ---- Stage 1: AUTHOR -------------------------------------------------
  await emit(sink, "authoring");
  const draft = await ports.author.author(input);

  // ---- Stage 2 + 3: FAN OUT + RESOLVE/RETRY ----------------------------
  const blocks = visualBlocks(draft);
  const total = blocks.length;
  await emit(sink, "composing", { done: 0, total });

  // Resolve every visual block IN PARALLEL. `done` advances as each settles so
  // the polled progress is honest about how many remain. A worker that throws or
  // returns a `none` result drops its slot (status "dropped", no payload).
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

  // ---- Stage 4: ASSEMBLE ----------------------------------------------
  await emit(sink, "assembling");
  const doc = assemble(draft, byId);

  return doc;
}

/**
 * Resolve one visual block via the medium-appropriate worker. Returns the
 * ResolvedVisual on success, or a `none` ResolvedVisual on terminal failure
 * (a thrown worker error is also normalized to `none`). The assemble step turns
 * a `none` into a DROPPED slot.
 */
async function resolveOneVisual(
  block: VisualBlock,
  workers: VisualWorkers,
): Promise<ResolvedVisual> {
  const medium = mediumForKind(block.kind);
  const worker = workers[medium];
  try {
    const resolved = await worker.resolve({
      id: block.id,
      kind: block.kind,
      spec: block.spec,
    });
    return resolved;
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
 * ASSEMBLE — substitute resolved payloads into visual blocks and DROP any slot
 * whose worker failed (a `none` result, a missing resolution, or a still-pending
 * block). Prose stands alone, so dropping a visual leaves a complete, coherent
 * lesson with NO dangling reference. Stamps `contentGeneratedAt`.
 *
 * Exported so Slice 5 (QA) can unit-test assemble in isolation against a mock
 * Author + mock workers (redesign §11).
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
      // Drop the slot cleanly when there is no usable payload: missing
      // resolution, a `none` result, or a payload the worker could not produce.
      if (!resolved || resolved.medium === "none") {
        return acc; // dropped: omit the block entirely (no dangling ref)
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
