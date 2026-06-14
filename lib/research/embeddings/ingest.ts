/**
 * Phase-2 Qdrant ingestion path (proves the end-to-end path, not throwaway).
 * Writes embedded chunks into a per-model collection l2_eval_<model>.
 */
import { qdrant, ensureCollection } from "../../vector/qdrant";
import type { Chunk } from "./chunk";

/** Qdrant requires unsigned-int or UUID point ids; map chunk ids deterministically. */
function pointId(i: number): number {
  return i + 1;
}

export interface IngestResult {
  collection: string;
  dim: number;
  pointCount: number;
}

export async function ingestChunks(
  modelId: string,
  chunks: Chunk[],
  vectors: number[][],
): Promise<IngestResult> {
  if (chunks.length !== vectors.length) {
    throw new Error(`ingest: chunk/vector length mismatch ${chunks.length} != ${vectors.length}`);
  }
  const dim = vectors[0]?.length ?? 0;
  const safe = modelId.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const collection = `l2_eval_${safe}`;

  // Recreate so re-runs are idempotent and the dim always matches the model.
  try {
    await qdrant.deleteCollection(collection);
  } catch {
    // collection may not exist yet
  }
  await ensureCollection(collection, dim, "Cosine");

  await qdrant.upsert(collection, {
    wait: true,
    points: chunks.map((c, i) => ({
      id: pointId(i),
      vector: vectors[i],
      payload: { chunkId: c.id, sourceUrl: c.sourceUrl, text: c.text.slice(0, 2000) },
    })),
  });

  const info = await qdrant.getCollection(collection);
  return { collection, dim, pointCount: info.points_count ?? chunks.length };
}
