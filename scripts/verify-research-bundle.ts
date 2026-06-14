/**
 * L2 Phase 0 — standalone verification of the research-bundle spine.
 * Run: `bun run scripts/verify-research-bundle.ts`. Exits non-zero on any failure.
 *
 * Two halves:
 *   (A) PURE — fingerprint determinism + divergence (no DB, no network).
 *   (B) DB-backed — the BundleStore read-through cache, source/chunk dedup +
 *       idempotency, the journey bind, and the end-to-end assertion that a journey
 *       bound to a (Phase 0 MOCK) bundle resolves NON-EMPTY, VALID sourceIds. Uses
 *       a throwaway User + LearningIntent that is fully cleaned up afterward.
 *
 * Phase 0 contract: zero external dependencies (the agent is the deterministic
 * mock), so this runs offline / in CI with only a local Postgres.
 */

import { fingerprint, FINGERPRINT_VERSION } from "../lib/research/fingerprint";
import {
  bindJourneyBundle,
  resolveJourneySourceIds,
  scrubSourceIds,
} from "../lib/journey/researchBundle";
import { prisma } from "../lib/db";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

// ---------------------------------------------------------------------------
// (A) Fingerprint — pure determinism + divergence
// ---------------------------------------------------------------------------

const outcomeA = [
  { text: "Explain the default mode network", bloomLevel: "understand" },
  { text: "Apply it to a case study", bloomLevel: "apply" },
];

const fp1 = fingerprint("Default Mode Network", outcomeA);
const fp2 = fingerprint("Default Mode Network", outcomeA);
check("fingerprint is deterministic (same input -> same hash)", fp1 === fp2, fp1);

check(
  "fingerprint is versioned (prefix present)",
  fp1.startsWith(`${FINGERPRINT_VERSION}:`),
  fp1,
);

// Normalization: case + surrounding whitespace + trailing punctuation collapse.
const fpNorm = fingerprint("  default mode network  ", [
  { text: "Apply it to a case study", bloomLevel: "apply" },
  { text: "explain the default mode network.", bloomLevel: "understand" },
]);
check(
  "fingerprint normalizes case/whitespace/order/punctuation (same topic -> same hash)",
  fpNorm === fp1,
  `${fpNorm} === ${fp1}`,
);

const fpDifferentSubject = fingerprint("Lean Manufacturing", outcomeA);
check(
  "different subject -> different hash",
  fpDifferentSubject !== fp1,
  fpDifferentSubject,
);

const fpDifferentOutcome = fingerprint("Default Mode Network", [
  { text: "Critique a study design", bloomLevel: "evaluate" },
]);
check(
  "different outcome shape -> different hash",
  fpDifferentOutcome !== fp1,
  fpDifferentOutcome,
);

// ---------------------------------------------------------------------------
// (B) BundleStore — DB-backed dedup, idempotency, journey bind, real sourceIds
// ---------------------------------------------------------------------------

async function runDbChecks(): Promise<void> {
  const stamp = `verify-research-bundle-${Date.now()}`;
  const topicFingerprint = `${FINGERPRINT_VERSION}:test-${stamp}`;
  const topicLabel = `Test topic ${stamp}`;

  const user = await prisma.user.create({
    data: { email: `${stamp}@example.test`, isAnonymous: true },
  });
  const intentA = await prisma.learningIntent.create({
    data: { userId: user.id, rawText: stamp, status: "in_progress" },
  });
  const intentB = await prisma.learningIntent.create({
    data: { userId: user.id, rawText: stamp, status: "in_progress" },
  });

  try {
    // First bind: cache MISS -> create + fill + bind.
    const bundleId1 = await bindJourneyBundle({
      intentId: intentA.id,
      topicFingerprint,
      topicLabel,
    });
    check("first bind returns a bundle id (MISS path)", Boolean(bundleId1), `${bundleId1}`);

    const bundle = await prisma.researchBundle.findUnique({
      where: { topicFingerprint },
      include: { sources: true },
    });
    check("bundle is marked ready after fill", bundle?.status === "ready", bundle?.status);
    check(
      "bundle has at least 1 source (live agent)",
      (bundle?.sources.length ?? 0) >= 1,
      `${bundle?.sources.length} sources`,
    );

    const sourceCountAfterFirst = await prisma.source.count();
    const chunkCountAfterFirst = await prisma.sourceChunk.count();

    // Second bind on a DIFFERENT journey, SAME fingerprint: cache HIT -> reuse the
    // same bundle, NO new Source / SourceChunk rows (global dedup + idempotency).
    const bundleId2 = await bindJourneyBundle({
      intentId: intentB.id,
      topicFingerprint,
      topicLabel,
    });
    check(
      "second bind (HIT) returns the SAME bundle id (topic reuse)",
      bundleId2 === bundleId1,
      `${bundleId2} === ${bundleId1}`,
    );

    const sourceCountAfterSecond = await prisma.source.count();
    const chunkCountAfterSecond = await prisma.sourceChunk.count();
    check(
      "HIT path adds NO new Source rows (dedup/idempotent)",
      sourceCountAfterSecond === sourceCountAfterFirst,
      `${sourceCountAfterFirst} -> ${sourceCountAfterSecond}`,
    );
    check(
      "HIT path adds NO new SourceChunk rows (content-addressed dedup)",
      chunkCountAfterSecond === chunkCountAfterFirst,
      `${chunkCountAfterFirst} -> ${chunkCountAfterSecond}`,
    );

    const bundleCount = await prisma.researchBundle.count({
      where: { topicFingerprint },
    });
    check(
      "exactly ONE bundle exists for the fingerprint (unique idempotency)",
      bundleCount === 1,
      `${bundleCount} bundles`,
    );

    // End-to-end: a journey bound to the mock bundle resolves NON-EMPTY, VALID
    // sourceIds that all reference real Source rows in the bound bundle.
    const resolved = await resolveJourneySourceIds(intentA.id);
    check(
      "journey resolves NON-EMPTY sourceIds (the [] -> real-ids proof)",
      resolved.length > 0,
      `${resolved.length} sourceIds`,
    );
    const realSources = await prisma.source.findMany({
      where: { id: { in: resolved } },
      select: { id: true },
    });
    check(
      "every resolved sourceId references a real Source row",
      realSources.length === resolved.length,
      `${realSources.length}/${resolved.length} resolvable`,
    );

    // Scrub: dangling / cross-journey ids are dropped; valid ids are kept + deduped.
    const scrubbed = await scrubSourceIds(intentA.id, [
      ...resolved,
      ...resolved, // duplicate
      "not-a-real-source-id",
    ]);
    check(
      "scrubSourceIds drops dangling ids and dedups",
      scrubbed.length === resolved.length &&
        scrubbed.every((id) => resolved.includes(id)),
      `kept ${scrubbed.length} of ${resolved.length} valid`,
    );

    // A journey bound to NO bundle resolves [] (older journeys stay ungrounded).
    const intentUnbound = await prisma.learningIntent.create({
      data: { userId: user.id, rawText: stamp, status: "in_progress" },
    });
    const resolvedUnbound = await resolveJourneySourceIds(intentUnbound.id);
    check(
      "unbound journey resolves [] (older journeys never break)",
      resolvedUnbound.length === 0,
      `${resolvedUnbound.length} sourceIds`,
    );
  } finally {
    // Cleanup: delete the throwaway journeys + bundle + its sources. Cascades take
    // JourneyBundle / BundleSource / SourceChunk; Source is global so delete by id.
    try {
      const bundle = await prisma.researchBundle.findUnique({
        where: { topicFingerprint },
        include: { sources: true },
      });
      const sourceIds = bundle?.sources.map((s) => s.sourceId) ?? [];
      if (bundle) {
        await prisma.researchBundle.delete({ where: { id: bundle.id } });
      }
      if (sourceIds.length) {
        await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
      }
      await prisma.user.delete({ where: { id: user.id } });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[verify-research-bundle] cleanup warning: ${(err as Error).message}`);
    }
  }
}

await runDbChecks();

// eslint-disable-next-line no-console
console.log(`\n${ok} passed, ${fail} failed`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
