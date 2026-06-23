/**
 * kc_passages — the single shared production Qdrant collection for L2.
 *
 * Layout is fixed by the ratified storage/search composition decision
 * (decisions/2026-06-15-l2-library-storage-search-composition.html):
 *   - one collection, vectors { size: 3072, distance: Cosine } (ADR-9 lock),
 *   - point id = deterministic UUIDv5(SourceChunk.contentHash) so re-ingest is
 *     idempotent (same content -> same point, never a duplicate),
 *   - payload joins back to Postgres (chunkId, sourceId) and carries the bundle
 *     scope (bundleIds) used by all three access patterns,
 *   - keyword payload indexes on sourceId, bundleIds, sourceKind.
 *
 * Qdrant is a rebuildable derived index, never a source of truth. Changing the
 * name or dim requires a full re-ingestion.
 */
import { createHash } from "crypto";
import { qdrant } from "./qdrant";

export const KC_PASSAGES = "kc_passages";
export const KC_PASSAGES_DIM = 3072;
export const KC_PASSAGES_DISTANCE = "Cosine" as const;

/** Payload fields that carry a keyword index for filtered top-k. */
export const KC_PASSAGES_KEYWORD_INDEXES = ["sourceId", "bundleIds", "sourceKind"] as const;

export interface KcPassagePayload {
  chunkId: string;
  sourceId: string;
  bundleIds: string[];
  ordinal: number;
  sourceKind: string;
  textPreview: string;
}

/** ~300 chars is enough to display a hit without a Postgres round-trip. */
const TEXT_PREVIEW_LEN = 300;

export function textPreview(text: string): string {
  return text.slice(0, TEXT_PREVIEW_LEN);
}

/**
 * RFC 4122 UUIDv5 over an arbitrary name using a fixed namespace. Implemented on
 * Node crypto (sha1) to avoid a uuid dependency. Deterministic: the same
 * contentHash always yields the same point id, which is what makes re-ingest a
 * no-op upsert rather than a duplicate.
 */
const KC_NAMESPACE = "6f4d2a7e-8c3b-4f1a-9d2e-1b5c7a0e3f44";

export function passagePointId(contentHash: string): string {
  const ns = Buffer.from(KC_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(ns)
    .update(Buffer.from(contentHash, "utf8"))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Idempotently provision kc_passages: create the dim-locked Cosine collection if
 * absent, then ensure the three keyword payload indexes exist. Safe to call on
 * every startup / first ingest — collection and index creation are no-ops when
 * already present.
 */
export async function ensureKcPassages(): Promise<void> {
  let exists = true;
  try {
    await qdrant.getCollection(KC_PASSAGES);
  } catch {
    exists = false;
  }
  if (!exists) {
    await qdrant.createCollection(KC_PASSAGES, {
      vectors: { size: KC_PASSAGES_DIM, distance: KC_PASSAGES_DISTANCE },
    });
  }
  for (const field of KC_PASSAGES_KEYWORD_INDEXES) {
    try {
      await qdrant.createPayloadIndex(KC_PASSAGES, {
        field_name: field,
        field_schema: "keyword",
        wait: true,
      });
    } catch {
      // Index already exists; createPayloadIndex is not idempotent server-side.
    }
  }
}

export interface PassageHit {
  score: number;
  payload: KcPassagePayload;
}

export interface PassageQueryFilter {
  /** Match a single bundle id (matches if the chunk's bundleIds array contains it). */
  bundleId?: string;
  /** Match a single source id. */
  sourceId?: string;
  /** Match a source kind ("academic" | "web"). */
  sourceKind?: string;
}

/**
 * The single retrieval primitive shared by all three access patterns: a
 * payload-filtered cosine top-k search against kc_passages. The caller embeds
 * the query (with embedPassages) and passes the vector. Hits carry the join
 * keys (chunkId, sourceId) the caller resolves back to Postgres for citable
 * metadata.
 */
export async function searchPassages(args: {
  vector: number[];
  limit?: number;
  filter?: PassageQueryFilter;
  scoreThreshold?: number;
}): Promise<PassageHit[]> {
  const must: Array<Record<string, unknown>> = [];
  if (args.filter?.bundleId) must.push({ key: "bundleIds", match: { value: args.filter.bundleId } });
  if (args.filter?.sourceId) must.push({ key: "sourceId", match: { value: args.filter.sourceId } });
  if (args.filter?.sourceKind) must.push({ key: "sourceKind", match: { value: args.filter.sourceKind } });

  const res = await qdrant.search(KC_PASSAGES, {
    vector: args.vector,
    limit: args.limit ?? 10,
    with_payload: true,
    ...(must.length ? { filter: { must } } : {}),
    ...(args.scoreThreshold !== undefined ? { score_threshold: args.scoreThreshold } : {}),
  });

  return res.map((p) => ({
    score: p.score,
    payload: p.payload as unknown as KcPassagePayload,
  }));
}
