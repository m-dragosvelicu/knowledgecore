/**
 * L2 Phase 0 — the BundleStore: read-through cache + persistence + journey bind.
 *
 * This is the persistence half of the Library (backend-engineer.md §2.3 / §4). It
 * turns a topic fingerprint into a bound `ResearchBundle`:
 *
 *   - HIT  (a ready bundle for the fingerprint exists) -> just bind the journey.
 *   - MISS -> create the bundle (status researching), run the (Phase 0 MOCK)
 *             agent to fill its Sources / SourceChunks / BundleSourceLink rows, mark
 *             it ready, then bind the journey via JourneyBundleLink.
 *
 * The create is made IDEMPOTENT against the `topicFingerprint` UNIQUE constraint:
 * a concurrent create that loses the race catches the unique violation and
 * re-reads the winner's bundle (DB-enforced convergence, not application luck).
 *
 * Every path here is BEST-EFFORT / non-fatal by contract: a research/persistence
 * failure must never break the journey spine. Callers (acceptPathAction) swallow
 * and keep, exactly like `ensureLessonContent`. On any failure the journey simply
 * stays ungrounded (sourceIds [] downstream), as it is today.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ingestBundle } from "@/lib/research/embeddings/bundleIngest";
import { getResearchAgent } from "@/lib/services";
import type { Bundle } from "@/lib/services/research";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Ensure the journey is bound to a ready ResearchBundle for `topicFingerprint`,
 * researching + persisting one (via the Phase 0 mock agent) on cache miss.
 *
 * Returns the bound bundle id, or null if anything failed (the spine stays
 * ungrounded, never broken). Idempotent: re-binding an already-bound journey is a
 * no-op upsert.
 */
export async function bindJourneyBundle(args: {
  intentId: string;
  topicFingerprint: string;
  topicLabel: string;
  goalpostQueries?: string[];
}): Promise<string | null> {
  const { intentId, topicFingerprint, topicLabel } = args;
  try {
    const bundleId = await ensureBundle(
      topicFingerprint,
      topicLabel,
      args.goalpostQueries ?? [],
    );
    if (!bundleId) return null;

    // Bind the journey to the bundle (M:N). Idempotent: the composite PK means a
    // re-run is a no-op rather than a duplicate row.
    await prisma.journeyBundleLink.upsert({
      where: { intentId_bundleId: { intentId, bundleId } },
      update: {},
      create: { intentId, bundleId },
    });
    return bundleId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[research-bundle] bind failed for intent "${intentId}"; journey stays ` +
        `ungrounded. ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Read-through cache for a topic fingerprint. Returns the id of a READY bundle,
 * creating + filling one on miss. Null only if research/persistence failed.
 */
async function ensureBundle(
  topicFingerprint: string,
  topicLabel: string,
  goalpostQueries: string[],
): Promise<string | null> {
  // HIT: a ready bundle already exists for this topic — zero research cost.
  const existing = await prisma.researchBundle.findUnique({
    where: { topicFingerprint },
  });
  if (existing && existing.status === "ready") return existing.id;
  // A bundle row exists but is not ready (a prior run failed mid-fill, or a
  // concurrent create is in flight). Re-fill it idempotently below.
  if (existing) {
    return fillBundle(existing.id, topicFingerprint, topicLabel, goalpostQueries);
  }

  // MISS: create the bundle row (status researching). Race-safe via the unique
  // constraint — a loser catches P2002 and re-reads the winner.
  let bundleId: string;
  try {
    const created = await prisma.researchBundle.create({
      data: { topicFingerprint, topicLabel, status: "researching" },
    });
    bundleId = created.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_VIOLATION
    ) {
      const winner = await prisma.researchBundle.findUnique({
        where: { topicFingerprint },
      });
      if (!winner) throw err;
      if (winner.status === "ready") return winner.id;
      bundleId = winner.id;
    } else {
      throw err;
    }
  }

  return fillBundle(bundleId, topicFingerprint, topicLabel, goalpostQueries);
}

/**
 * Run the live Research Agent and persist its sources/chunks into the bundle,
 * then mark it ready. Sources are globally deduped by `dedupKey`; chunks by
 * `contentHash` — so re-filling the same topic is idempotent. On failure the
 * bundle is marked failed and null is returned (journey stays ungrounded).
 */
async function fillBundle(
  bundleId: string,
  topicFingerprint: string,
  topicLabel: string,
  goalpostQueries: string[],
): Promise<string | null> {
  try {
    const agent = getResearchAgent();
    const bundle: Bundle = await agent.research(
      topicFingerprint,
      topicLabel,
      goalpostQueries,
    );

    for (const src of bundle.sources) {
      // Global source dedup: the same paper/page is one row across all bundles.
      const source = await prisma.source.upsert({
        where: { dedupKey: src.dedupKey },
        update: {},
        create: {
          kind: src.kind,
          status: "fetched",
          dedupKey: src.dedupKey,
          doi: src.doi,
          canonicalUrl: src.canonicalUrl,
          title: src.title,
          authors: (src.authors ?? []) as unknown as object,
          venue: src.venue,
          publishedYear: src.publishedYear,
          rawText: src.rawText,
        },
      });

      // Chunks are content-addressed: re-chunking the same source is a no-op.
      for (const chunk of src.chunks) {
        await prisma.sourceChunk.upsert({
          where: { contentHash: chunk.contentHash },
          update: {},
          create: {
            sourceId: source.id,
            ordinal: chunk.ordinal,
            text: chunk.text,
            contentHash: chunk.contentHash,
          },
        });
      }

      // Link the source into THIS bundle (M:N). Idempotent on the composite PK.
      await prisma.bundleSourceLink.upsert({
        where: { bundleId_sourceId: { bundleId, sourceId: source.id } },
        update: {},
        create: { bundleId, sourceId: source.id, scopeNote: src.scopeNote },
      });
    }

    // Best-effort: an ingest failure must not block bundle readiness; Postgres grounding stays intact.
    try {
      await ingestBundle(bundleId);
    } catch (e) {
      console.warn(`[research-bundle] ingest failed for ${bundleId}; ungrounded search`, e);
    }

    await prisma.researchBundle.update({
      where: { id: bundleId },
      data: { status: "ready" },
    });
    return bundleId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[research-bundle] fill failed for topic "${topicLabel}"; marking bundle ` +
        `failed, journey stays ungrounded. ${(err as Error).message}`,
    );
    try {
      await prisma.researchBundle.update({
        where: { id: bundleId },
        data: { status: "failed" },
      });
    } catch {
      // best-effort status write; ignore
    }
    return null;
  }
}

/**
 * Resolve the `Source.id`s a journey is allowed to cite: every source reachable
 * via `BundleSourceLink` from a READY bundle the journey is bound to (`JourneyBundleLink`).
 * This is the provenance scope. Returns [] when the journey is bound to no ready
 * bundle (older journeys stay ungrounded, exactly as today).
 */
export async function resolveJourneySourceIds(intentId: string): Promise<string[]> {
  try {
    const links = await prisma.journeyBundleLink.findMany({
      where: { intentId, bundle: { status: "ready" } },
      select: {
        bundle: { select: { sources: { select: { sourceId: true } } } },
      },
    });
    const ids = new Set<string>();
    for (const link of links) {
      for (const bs of link.bundle.sources) ids.add(bs.sourceId);
    }
    return [...ids];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[research-bundle] resolveJourneySourceIds failed for intent ` +
        `"${intentId}"; returning []. ${(err as Error).message}`,
    );
    return [];
  }
}

/**
 * Validation/scrub helper: keep only the candidate sourceIds that are actually
 * reachable from a ready bundle the journey is bound to. This enforces the
 * provenance integrity invariant (R-4) on the write path — JSON `sourceIds`
 * cannot be FK-constrained, so we scrub dangling ids in code before persisting.
 *
 * @param intentId the journey whose bound bundles define the allowed set
 * @param candidateSourceIds ids a generator proposed to write
 * @returns the subset that is valid (deduped); [] if none are valid
 */
export async function scrubSourceIds(
  intentId: string,
  candidateSourceIds: string[],
): Promise<string[]> {
  if (candidateSourceIds.length === 0) return [];
  const allowed = new Set(await resolveJourneySourceIds(intentId));
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of candidateSourceIds) {
    if (allowed.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push(id);
    }
  }
  return kept;
}
