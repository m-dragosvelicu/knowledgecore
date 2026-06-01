/**
 * L2 Phase 0 — the Research Agent service contract (additive).
 *
 * The Research Agent goes online (later phases), finds credible sources, and
 * assembles a "core source material bundle" the grounded-generation seams read.
 * In Phase 0 the agent is a deterministic MOCK returning a canned bundle (zero
 * network, zero keys, zero embeddings) so the whole spine
 * `path-confirm -> bundle -> grounded generation -> real sourceIds` is provable
 * offline / in CI.
 *
 * This contract is ADDITIVE — it does NOT touch the LOCKED `lib/services/types.ts`
 * interface boundary. It lives alongside it (L1 precedent: `lessonContent.ts`,
 * `pathConfirmation.ts`, `transcription.ts`, `visualMedia.ts`) and is wired
 * through `getServices()`'s separate-selector pattern.
 */

import type { SourceKind } from "@prisma/client";

/**
 * One embeddable passage of a source. The `sourceId` here is the Research Agent's
 * OWN stable id for the chunk's parent source within the bundle it returns; the
 * BundleStore maps it to the persisted `Source.id` it mints/dedupes. The chunk
 * `text` is what generation is conditioned on (the "content selection" half of
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
 * The Research Agent service. Phase 0 ships the MOCK only; live retrieval +
 * `amend` real behaviour land in later phases.
 */
export interface ResearchAgent {
  /**
   * Assemble (or, live, research) the bundle for a topic. `goalpostQueries` is
   * the per-goalpost query set generation would ground against (ignored by the
   * Phase 0 mock, which returns a fixed canned bundle).
   */
  research(
    topicKey: string,
    topicLabel: string,
    goalpostQueries: string[],
  ): Promise<Bundle>;

  /**
   * Targeted amend of an existing bundle (later phase). Phase 0 mock returns a
   * fixed canned bundle so the contract type-checks end to end.
   */
  amend(bundleId: string, gapQueries: GapQueries): Promise<Bundle>;
}
