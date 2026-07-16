/**
 * L2 Phase 0 — the BundleStore: read-through cache + persistence + journey
 * bind (backend-engineer.md §2.3/§4). Turns a topic fingerprint into a bound
 * `ResearchBundle`: HIT (ready bundle exists) just binds the journey; MISS
 * creates the bundle (status researching), runs the Research Agent to fill
 * Sources/SourceChunks/BundleSourceLink, marks it ready, then binds via
 * JourneyBundleLink. Create is idempotent against the `topicFingerprint`
 * unique constraint — a losing concurrent create catches the violation and
 * re-reads the winner's bundle.
 *
 * Every path here is best-effort/non-fatal: a research/persistence failure
 * must never break the journey spine (callers swallow and keep, like
 * `ensureLessonContent`); the journey just stays ungrounded (sourceIds []).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ingestBundle } from "@/lib/research/embeddings/bundleIngest";
import { fingerprint, type OutcomeShape } from "@/lib/research/fingerprint";
import { getResearchAgent } from "@/lib/services";
import type { Bundle } from "@/lib/services/research";
import {
  isResearchProgressState,
  makeResearchProgressState,
  stateForResearchEvent,
  type ResearchProgressState,
} from "./researchProgressState";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Best-effort write of the live sub-stage onto the bundle row (E04.S03). The
 * `status` enum stays the authoritative terminal signal; this column only
 * carries the honest in-flight detail the T3 ladder polls. A write failure
 * must never break the fill.
 */
async function writeBundleProgress(
  bundleId: string,
  state: ResearchProgressState,
): Promise<void> {
  try {
    await prisma.researchBundle.update({
      where: { id: bundleId },
      data: { progress: state as unknown as Prisma.InputJsonValue },
    });
  } catch {
    // Progress telemetry is advisory; never let a write failure break the fill.
  }
}

/**
 * The progress record the research-fill ladder polls, keyed by the journey
 * (the client never has the bundle id). Resolves the bundle the same way
 * ensureBundle is keyed: recompute the topic fingerprint and look it up.
 * Returns null if the journey can never have a fill (no subject) or the read
 * failed; `searching` if no bundle row yet or a fill is running with no
 * sub-stage write; otherwise the live sub-stage or terminal ready/failed.
 *
 * `status` stays authoritative for terminals, except: a "failed" status with
 * a RUNNING progress record means a re-fill is in flight (fillBundle
 * rewrites progress before flipping status), so the live record wins.
 */
export async function readBundleProgressForIntent(
  intentId: string,
): Promise<ResearchProgressState | null> {
  try {
    const [subject, outcome] = await Promise.all([
      prisma.subject.findUnique({ where: { intentId } }),
      prisma.expectedOutcome.findUnique({ where: { intentId } }),
    ]);
    if (!subject) return null;

    const fp = fingerprint(
      subject.canonicalName,
      (outcome?.canDoStatements ?? []) as unknown as OutcomeShape,
    );
    const bundle = await prisma.researchBundle.findUnique({
      where: { topicFingerprint: fp },
      select: { status: true, progress: true },
    });
    if (!bundle) return makeResearchProgressState("searching");

    const live = isResearchProgressState(bundle.progress) ? bundle.progress : null;
    if (bundle.status === "ready") return makeResearchProgressState("ready");
    if (bundle.status === "failed") {
      return live?.status === "running" ? live : makeResearchProgressState("failed");
    }
    return live ?? makeResearchProgressState("searching");
  } catch (err) {
    console.warn(
      `[research-bundle] progress read failed for intent "${intentId}". ` +
        `${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Ensure the journey is bound to a ready ResearchBundle for `topicFingerprint`,
 * researching + persisting one (via the live Research Agent) on cache miss.
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
    await writeBundleProgress(bundleId, makeResearchProgressState("searching"));

    const agent = getResearchAgent();
    const bundle: Bundle = await agent.research(
      topicFingerprint,
      topicLabel,
      goalpostQueries,
      (event) => writeBundleProgress(bundleId, stateForResearchEvent(event)),
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

    // Indexing is a single opaque stage (no honest per-chunk count without an
    // invasive change to the embedding loop — see E04.S03 report). Best-effort:
    // an ingest failure must not block bundle readiness; Postgres grounding
    // stays intact, and the ladder degrades straight to "ready" below, never a
    // hard error, per the E01.S09 contract.
    await writeBundleProgress(bundleId, makeResearchProgressState("indexing"));
    try {
      await ingestBundle(bundleId);
    } catch (e) {
      console.warn(`[research-bundle] ingest failed for ${bundleId}; ungrounded search`, e);
    }

    await prisma.researchBundle.update({
      where: { id: bundleId },
      data: {
        status: "ready",
        progress: makeResearchProgressState("ready") as unknown as Prisma.InputJsonValue,
      },
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
        data: {
          status: "failed",
          progress: makeResearchProgressState("failed", {
            label: "We could not gather sources just now",
          }) as unknown as Prisma.InputJsonValue,
        },
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
