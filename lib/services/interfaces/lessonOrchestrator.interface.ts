/**
 * The port contracts the lesson orchestrator (lib/journey/lesson/orchestrator.ts)
 * runs against: an Author (Phase 1) and per-medium visual workers (Phase 2),
 * plus the best-effort progress sink. Implementations live in
 * lib/services/providers/lessonAuthor.service.ts and
 * lib/services/providers/visualWorkers.service.ts.
 */

import type { DraftLessonDoc, VisualBlock } from "@/lib/services/lessonDoc";
import type { LessonContentInput } from "@/lib/services/lessonContent";
import type { ResolvedVisual, VisualMedium } from "@/lib/services/visualMedia";
import type { LessonGenerationState } from "@/lib/journey/lesson/generationState";

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
