/**
 * E01.S05 — standalone verification of the kc_passages bootstrap + bundle ingest.
 * Run: `bun run scripts/verify-qdrant-ingest.ts`. Exits non-zero on any failure.
 * Uses REAL infra (live Qdrant + Postgres + Gemini embeddings).
 *
 * Covers: collection bootstrap (dim-3072 Cosine + keyword payload indexes),
 * ingest of a seeded bundle (content-addressed points), filtered top-k by
 * bundleId/sourceId, idempotent re-ingest (UUIDv5(contentHash) dedup), and
 * embeddedAt/embeddingModel/embeddingDim stamping.
 *
 * Throwaway bundle + sources are fully cleaned up afterward (Postgres + Qdrant).
 */

import { createHash } from "crypto";
import { prisma } from "../lib/db";
import { qdrant } from "../lib/vector/qdrant";
import {
  KC_PASSAGES,
  KC_PASSAGES_DIM,
  KC_PASSAGES_KEYWORD_INDEXES,
  ensureKcPassages,
  passagePointId,
  searchPassages,
} from "../lib/vector/kcPassages";
import { ingestBundle } from "../lib/research/embeddings/bundleIngest";
import { embedPassages, EMBEDDING_DIM, EMBEDDING_MODEL } from "../lib/research/embeddings/embed";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Realistic seed passages (the kind of clean extracted text the agent persists).
const PASSAGES = [
  "Spaced repetition schedules reviews at increasing intervals so that each retrieval happens just before forgetting, which strengthens long-term retention more than massed practice.",
  "The testing effect shows that actively retrieving information from memory produces more durable learning than simply re-reading the same material the equivalent number of times.",
  "Interleaving different problem types within a single study session improves the ability to discriminate between problems and select the correct strategy, at the cost of feeling harder during practice.",
];

async function run(): Promise<void> {
  const stamp = `verify-qdrant-${Date.now()}`;

  // ---- 1. Bootstrap -------------------------------------------------------
  await ensureKcPassages();
  const info = await qdrant.getCollection(KC_PASSAGES);
  const cfgVectors = (info.config?.params?.vectors ?? {}) as { size?: number; distance?: string };
  check("kc_passages collection exists", Boolean(info), KC_PASSAGES);
  check("collection vector dim is 3072", cfgVectors.size === KC_PASSAGES_DIM, `size=${cfgVectors.size}`);
  check("collection distance is Cosine", cfgVectors.distance === "Cosine", `distance=${cfgVectors.distance}`);

  const payloadSchema = (info.payload_schema ?? {}) as Record<string, { data_type?: string }>;
  for (const field of KC_PASSAGES_KEYWORD_INDEXES) {
    const dt = payloadSchema[field]?.data_type;
    check(`payload index "${field}" exists (keyword)`, dt === "keyword", `data_type=${dt}`);
  }

  // ---- seed a realistic bundle -------------------------------------------
  const dedupKey = `${stamp}-doi`;
  const source = await prisma.source.create({
    data: {
      kind: "academic",
      status: "fetched",
      dedupKey,
      doi: `10.0000/${stamp}`,
      canonicalUrl: `https://example.test/${stamp}`,
      title: `Verify source ${stamp}`,
      authors: [{ name: "A. Tester" }] as unknown as object,
      venue: "Journal of Verification",
      publishedYear: 2026,
      rawText: PASSAGES.join("\n\n"),
    },
  });
  const bundle = await prisma.researchBundle.create({
    data: {
      topicFingerprint: `fp1:${stamp}`,
      topicLabel: `Verify topic ${stamp}`,
      status: "ready",
    },
  });
  await prisma.bundleSourceLink.create({
    data: { bundleId: bundle.id, sourceId: source.id, scopeNote: "verify" },
  });
  const chunkHashes: string[] = [];
  for (let i = 0; i < PASSAGES.length; i++) {
    const contentHash = sha256(`${source.id}:${PASSAGES[i]}`);
    chunkHashes.push(contentHash);
    await prisma.sourceChunk.create({
      data: { sourceId: source.id, ordinal: i, text: PASSAGES[i], contentHash },
    });
  }

  try {
    // ---- 2. Ingest --------------------------------------------------------
    const res1 = await ingestBundle(bundle.id);
    check("ingest reports all chunks upserted", res1.pointsUpserted === PASSAGES.length, `${res1.pointsUpserted}/${PASSAGES.length}`);

    // Points landed with the correct payload, addressed by UUIDv5(contentHash).
    const expectedIds = chunkHashes.map(passagePointId);
    const retrieved = await qdrant.retrieve(KC_PASSAGES, { ids: expectedIds, with_payload: true });
    check("all seeded points are present by UUIDv5(contentHash) id", retrieved.length === PASSAGES.length, `${retrieved.length}/${PASSAGES.length}`);

    const dbChunks = await prisma.sourceChunk.findMany({ where: { sourceId: source.id }, orderBy: { ordinal: "asc" } });
    const byId = new Map(retrieved.map((p) => [String(p.id), p.payload as Record<string, unknown>]));
    let payloadOk = true;
    for (const dc of dbChunks) {
      const pl = byId.get(passagePointId(dc.contentHash));
      if (!pl) { payloadOk = false; break; }
      const bundleIds = (pl.bundleIds as string[]) ?? [];
      if (
        pl.chunkId !== dc.id ||
        pl.sourceId !== source.id ||
        pl.ordinal !== dc.ordinal ||
        pl.sourceKind !== "academic" ||
        !bundleIds.includes(bundle.id) ||
        typeof pl.textPreview !== "string" ||
        !dc.text.startsWith(pl.textPreview as string)
      ) { payloadOk = false; break; }
    }
    check("every point payload matches its SourceChunk (chunkId/sourceId/ordinal/sourceKind/bundleIds/textPreview)", payloadOk);

    // ---- embeddedAt / embeddingModel / embeddingDim -----------------------
    const embeddedCount = await prisma.sourceChunk.count({ where: { sourceId: source.id, embeddedAt: { not: null } } });
    check("every SourceChunk.embeddedAt is set after ingest", embeddedCount === PASSAGES.length, `${embeddedCount}/${PASSAGES.length}`);
    const reloaded = await prisma.researchBundle.findUnique({ where: { id: bundle.id } });
    check("bundle.embeddingModel = gemini-embedding-001", reloaded?.embeddingModel === EMBEDDING_MODEL, `${reloaded?.embeddingModel}`);
    check("bundle.embeddingDim = 3072", reloaded?.embeddingDim === EMBEDDING_DIM, `${reloaded?.embeddingDim}`);

    // ---- 3. Filtered top-k queries ----------------------------------------
    const queryVec = (await embedPassages(["How does spacing out reviews help memory?"]))[0];

    const byBundle = await searchPassages({ vector: queryVec, limit: 10, filter: { bundleId: bundle.id } });
    check("filtered top-k by bundleId returns the seeded chunks", byBundle.length === PASSAGES.length, `${byBundle.length} hits`);
    check("top-k by bundleId hits all belong to this bundle", byBundle.every((h) => h.payload.bundleIds.includes(bundle.id)), `${byBundle.length} hits`);
    check(
      "top hit is the spaced-repetition passage (cosine ranks the relevant chunk first)",
      byBundle[0]?.payload.chunkId === dbChunks[0]?.id,
      `top chunkId=${byBundle[0]?.payload.chunkId}`,
    );

    const bySource = await searchPassages({ vector: queryVec, limit: 10, filter: { sourceId: source.id } });
    check("filtered top-k by sourceId returns the seeded chunks", bySource.length === PASSAGES.length, `${bySource.length} hits`);

    const otherBundle = await searchPassages({ vector: queryVec, limit: 10, filter: { bundleId: `no-such-bundle-${stamp}` } });
    check("filtered top-k by a non-existent bundleId returns nothing (scope isolation)", otherBundle.length === 0, `${otherBundle.length} hits`);

    // ---- 4. Idempotent re-ingest ------------------------------------------
    const countBefore = (await qdrant.count(KC_PASSAGES, { exact: true })).count;
    const res2 = await ingestBundle(bundle.id);
    const countAfter = (await qdrant.count(KC_PASSAGES, { exact: true })).count;
    check("re-ingest upserts the same chunk count (no error)", res2.pointsUpserted === PASSAGES.length, `${res2.pointsUpserted}`);
    check("re-ingest is idempotent: collection point count unchanged (no duplicate vectors)", countAfter === countBefore, `${countBefore} -> ${countAfter}`);
    check("re-ingest sees the chunks as already embedded", res2.alreadyEmbedded === PASSAGES.length, `${res2.alreadyEmbedded}/${PASSAGES.length}`);
  } finally {
    // Cleanup: remove the throwaway points from the shared collection, then the
    // Postgres rows (cascades take SourceChunk / links).
    try {
      await qdrant.delete(KC_PASSAGES, { wait: true, points: chunkHashes.map(passagePointId) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[verify-qdrant-ingest] qdrant cleanup warning: ${(err as Error).message}`);
    }
    try {
      await prisma.researchBundle.delete({ where: { id: bundle.id } });
      await prisma.source.delete({ where: { id: source.id } });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[verify-qdrant-ingest] pg cleanup warning: ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n${ok} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

await run();
