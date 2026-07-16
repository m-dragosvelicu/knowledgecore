/**
 * Passage-level ingestion of a ResearchBundle's chunks into kc_passages. Loads
 * every SourceChunk reachable via BundleSourceLink, embeds each chunk's text
 * (gemini-embedding-001, dim 3072), and upserts one point per chunk. Point id =
 * UUIDv5(contentHash), so re-ingesting the same content is a no-op upsert
 * (idempotent), never a duplicate.
 *
 * bundleIds in the payload is the FULL set of bundles each chunk grounds (a
 * globally-deduped chunk can belong to many), so grounding/search filters see
 * every bundle a passage belongs to, not just the one being ingested now.
 *
 * Best-effort like the rest of the Library spine: an embed/upsert failure must
 * not break the journey; errors are surfaced in the result, not thrown.
 */
import { prisma } from "@/lib/db";
import { qdrant } from "@/lib/vector/qdrant";
import {
  KC_PASSAGES,
  KcPassagePayload,
  ensureKcPassages,
  passagePointId,
  textPreview,
} from "@/lib/vector/kcPassages";
import { EMBEDDING_DIM, EMBEDDING_MODEL, embedPassages } from "./embed";

export interface BundleIngestResult {
  bundleId: string;
  chunksTotal: number;
  pointsUpserted: number;
  alreadyEmbedded: number;
}

interface ChunkRow {
  id: string;
  ordinal: number;
  text: string;
  contentHash: string;
  embeddedAt: Date | null;
  sourceId: string;
  sourceKind: string;
}

/** Embed a bundle's chunks and upsert them as kc_passages points. */
export async function ingestBundle(bundleId: string): Promise<BundleIngestResult> {
  await ensureKcPassages();

  const links = await prisma.bundleSourceLink.findMany({
    where: { bundleId },
    select: {
      source: {
        select: {
          id: true,
          kind: true,
          chunks: {
            select: {
              id: true,
              ordinal: true,
              text: true,
              contentHash: true,
              embeddedAt: true,
            },
          },
        },
      },
    },
  });

  const chunks: ChunkRow[] = [];
  for (const link of links) {
    for (const c of link.source.chunks) {
      chunks.push({
        id: c.id,
        ordinal: c.ordinal,
        text: c.text,
        contentHash: c.contentHash,
        embeddedAt: c.embeddedAt,
        sourceId: link.source.id,
        sourceKind: link.source.kind,
      });
    }
  }

  if (chunks.length === 0) {
    return { bundleId, chunksTotal: 0, pointsUpserted: 0, alreadyEmbedded: 0 };
  }

  // bundleIds payload = every bundle each chunk grounds (not just this one).
  const bundleIdsByChunk = await resolveBundleIdsByContentHash(
    chunks.map((c) => c.contentHash),
  );

  const vectors = await embedPassages(chunks.map((c) => c.text));

  const points = chunks.map((c, i) => {
    const payload: KcPassagePayload = {
      chunkId: c.id,
      sourceId: c.sourceId,
      bundleIds: bundleIdsByChunk.get(c.contentHash) ?? [bundleId],
      ordinal: c.ordinal,
      sourceKind: c.sourceKind,
      textPreview: textPreview(c.text),
    };
    return {
      id: passagePointId(c.contentHash),
      vector: vectors[i],
      payload: payload as unknown as Record<string, unknown>,
    };
  });

  await qdrant.upsert(KC_PASSAGES, { wait: true, points });

  const now = new Date();
  await prisma.sourceChunk.updateMany({
    where: { id: { in: chunks.map((c) => c.id) } },
    data: { embeddedAt: now },
  });
  await prisma.researchBundle.update({
    where: { id: bundleId },
    data: { embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM },
  });

  return {
    bundleId,
    chunksTotal: chunks.length,
    pointsUpserted: points.length,
    alreadyEmbedded: chunks.filter((c) => c.embeddedAt !== null).length,
  };
}

/**
 * Map each contentHash to the set of bundle ids it grounds, so a deduped chunk
 * shared across bundles carries all of them in its payload.
 */
async function resolveBundleIdsByContentHash(
  contentHashes: string[],
): Promise<Map<string, string[]>> {
  const rows = await prisma.sourceChunk.findMany({
    where: { contentHash: { in: contentHashes } },
    select: {
      contentHash: true,
      source: { select: { bundleLinks: { select: { bundleId: true } } } },
    },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const ids = [...new Set(r.source.bundleLinks.map((l) => l.bundleId))];
    map.set(r.contentHash, ids);
  }
  return map;
}
