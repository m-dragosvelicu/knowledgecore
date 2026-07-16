/**
 * Research Agent service contract (additive). Finds credible sources and
 * assembles a "core source material bundle" that grounded-generation reads.
 * Does not touch the locked `lib/services/types.ts` boundary — lives
 * alongside it (same pattern as lessonContent.ts, pathConfirmation.ts,
 * transcription.ts, visualMedia.ts) and is wired through `getServices()`'s
 * separate-selector pattern.
 */

import type { SourceKind } from "@prisma/client";

/**
 * One embeddable passage of a source. `contentHash` is the dedup key; the
 * BundleStore maps chunks to a persisted `Source.id`. `text` is what
 * generation is conditioned on (the "content selection" half of
 * attribute-first).
 */
export type Chunk = {
  /** Stable, content-addressable key for this chunk (used to dedup on persist). */
  contentHash: string;
  /** Position within the parent source. */
  ordinal: number;
  /** The extracted passage the generator may quote / paraphrase. */
  text: string;
};

/**
 * A single citable source the agent found. Globally deduped on persist by
 * `dedupKey` (DOI -> canonical URL -> sha256(text)).
 */
export type Source = {
  /** The agent's own stable id for this source within the returned bundle. */
  ref: string;
  kind: SourceKind;
  /** Global dedup key: DOI when present, else canonical URL, else sha256(text). */
  dedupKey: string;
  doi: string | null;
  canonicalUrl: string | null;
  title: string;
  authors: Array<{ name: string }>;
  venue: string | null;
  publishedYear: number | null;
  /** Normalized full text kept for re-chunk / re-embed. */
  rawText: string | null;
  /** Why this source is in the bundle (which goalpost/objective it grounds). */
  scopeNote: string | null;
  chunks: Chunk[];
};

/** The "core source material bundle" the agent assembles for one topic. */
export type Bundle = {
  /** Canonical topic key (the fingerprint) — enables Library reuse across users. */
  topicKey: string;
  /** Human-readable echo of what was fingerprinted (debug / Library browse). */
  topicLabel: string;
  sources: Source[];
};

/** A targeted query set for the (later-phase) amend pipeline. */
export type GapQueries = string[];

/**
 * Best-effort progress signal (E04.S03), mirroring the orchestrator's
 * `ProgressSink` contract (lib/journey/lessonOrchestration.ts): a sink that
 * throws must not abort research. `reading` reports genuine per-hit
 * extraction progress, never a fabricated count.
 */
export type ResearchProgressEvent =
  | { phase: "searching" }
  | { phase: "reading"; done: number; total: number };

export type ResearchProgressSink = (
  event: ResearchProgressEvent,
) => Promise<void> | void;

/**
 * The Research Agent service. Phase 0 ships the MOCK only; live retrieval +
 * `amend` real behaviour land in later phases.
 */
export interface ResearchAgent {
  /**
   * Assemble (or research live) the bundle for a topic. `goalpostQueries` is
   * the per-goalpost query set generation grounds against. `onProgress` is
   * optional and advisory only — omitting it changes nothing about the result.
   */
  research(
    topicKey: string,
    topicLabel: string,
    goalpostQueries: string[],
    onProgress?: ResearchProgressSink,
  ): Promise<Bundle>;

  /** Targeted amend of an existing bundle (later phase, not yet implemented). */
  amend(bundleId: string, gapQueries: GapQueries): Promise<Bundle>;
}
