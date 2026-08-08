/**
 * Types for retrieval-layer qrels (query relevance judgments) — see
 * qrels/README.md for the construction method and its honest limitations.
 */
import type { Chunk } from "../../embeddings/chunk";

export type { Chunk };

/** One query's ground truth: which candidate chunks a judge marked relevant. */
export interface QrelsEntry {
  queryId: string;
  topic: string;
  /** Chunk ids the judge marked as directly relevant. Empty = no label, or judge call failed. */
  relevantChunkIds: string[];
  /** The full candidate pool the judge saw (same-topic chunk ids). Needed to
   *  compute Recall@k/nDCG@k denominators and to detect judge hallucinated ids
   *  (filtered out before this entry is built — see build.ts). */
  candidateChunkIds: string[];
  /** Model id used for labelling, so a later re-run can tell which qrels came from which judge. */
  judgeModel: string;
  labelledAt: string;
  /** Set when the judge call threw; relevantChunkIds is [] in that case, not "0 relevant". */
  error?: string;
}

export type QrelsSet = Record<string, QrelsEntry>;
