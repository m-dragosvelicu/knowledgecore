/**
 * E01.S06 — standalone verification of the Library learner-search path.
 * Run: `bun run scripts/verify-learner-search.ts`. Exits non-zero on any failure.
 *
 * Exercises searchLibraryForLearner (the same function the API route calls)
 * against REAL infra (live Qdrant + Postgres + Gemini embeddings): relevance +
 * score floor, bundle-scope isolation between journeys, and deterministic
 * cosine-descending ranking.
 *
 * Creates two throwaway journeys/bundles, fully cleaned up (Postgres + Qdrant)
 * afterward.
 */

import { createHash } from "crypto";
import { prisma } from "../lib/db";
import { qdrant } from "../lib/vector/qdrant";
import { KC_PASSAGES, passagePointId } from "../lib/vector/kcPassages";
import { ingestBundle } from "../lib/research/embeddings/bundleIngest";
import {
  searchLibraryForLearner,
  LEARNER_SEARCH_SCORE_FLOOR,
} from "../lib/library/learnerSearch";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Topic A: memory-science passages (the relevant set for the test query).
const PASSAGES_A = [
  "Spaced repetition schedules reviews at increasing intervals so each retrieval happens just before forgetting, which strengthens long-term retention more than massed practice.",
  "The testing effect shows that actively retrieving information from memory produces more durable learning than re-reading the same material the equivalent number of times.",
  "Interleaving different problem types within one study session improves the ability to discriminate between problems and select the correct strategy.",
];

// Topic B: an UNRELATED domain (volcanology). Used to prove scope isolation: a
// journey bound only to bundle B must never see bundle A's memory passages.
const PASSAGES_B = [
  "Basaltic lava has low viscosity and flows freely, producing broad shield volcanoes such as those that built the Hawaiian island chain over a mantle hotspot.",
  "Explosive plinian eruptions eject a sustained column of ash and pumice tens of kilometres into the stratosphere, driven by the rapid exsolution of dissolved volatiles.",
];

interface SeededJourney {
  intentId: string;
  bundleId: string;
  sourceId: string;
  chunkHashes: string[];
}

async function seedJourney(
  userId: string,
  stamp: string,
  passages: string[],
  kind: "academic" | "web",
): Promise<SeededJourney> {
  const intent = await prisma.learningIntent.create({
    data: { userId, rawText: `verify learner-search ${stamp}`, status: "created" },
  });
  const source = await prisma.source.create({
    data: {
      kind,
      status: "fetched",
      dedupKey: `${stamp}-doi`,
      doi: `10.0000/${stamp}`,
      canonicalUrl: `https://example.test/${stamp}`,
      title: `Verify source ${stamp}`,
      authors: [{ name: "A. Tester" }, { name: "B. Reviewer" }] as unknown as object,
      venue: "Journal of Verification",
      publishedYear: 2026,
      rawText: passages.join("\n\n"),
    },
  });
  const bundle = await prisma.researchBundle.create({
    data: { topicFingerprint: `fp:${stamp}`, topicLabel: `Verify topic ${stamp}`, status: "ready" },
  });
  await prisma.bundleSourceLink.create({
    data: { bundleId: bundle.id, sourceId: source.id, scopeNote: "verify" },
  });
  await prisma.journeyBundleLink.create({
    data: { intentId: intent.id, bundleId: bundle.id },
  });
  const chunkHashes: string[] = [];
  for (let i = 0; i < passages.length; i++) {
    const contentHash = sha256(`${source.id}:${passages[i]}`);
    chunkHashes.push(contentHash);
    await prisma.sourceChunk.create({
      data: { sourceId: source.id, ordinal: i, text: passages[i], contentHash },
    });
  }
  await ingestBundle(bundle.id);
  return { intentId: intent.id, bundleId: bundle.id, sourceId: source.id, chunkHashes };
}

async function teardown(j: SeededJourney): Promise<void> {
  try {
    await qdrant.delete(KC_PASSAGES, { wait: true, points: j.chunkHashes.map(passagePointId) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[verify-learner-search] qdrant cleanup warning: ${(err as Error).message}`);
  }
  try {
    await prisma.researchBundle.delete({ where: { id: j.bundleId } });
    await prisma.source.delete({ where: { id: j.sourceId } });
    await prisma.learningIntent.delete({ where: { id: j.intentId } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[verify-learner-search] pg cleanup warning: ${(err as Error).message}`);
  }
}

async function run(): Promise<void> {
  const stamp = `verify-ls-${Date.now()}`;

  // A real user row to own the journeys (ownership is enforced at the route; the
  // service trusts the caller, so we only need a valid userId for the FK).
  const user = await prisma.user.create({
    data: { email: `${stamp}@verify.test`, name: "LS Verify", emailVerified: false },
  });

  let jA: SeededJourney | null = null;
  let jB: SeededJourney | null = null;
  let jUnbound: { intentId: string } | null = null;

  try {
    jA = await seedJourney(user.id, `${stamp}-a`, PASSAGES_A, "academic");
    jB = await seedJourney(user.id, `${stamp}-b`, PASSAGES_B, "web");

    const unbound = await prisma.learningIntent.create({
      data: { userId: user.id, rawText: `${stamp}-unbound`, status: "created" },
    });
    jUnbound = { intentId: unbound.id };

    // ---- 1. Relevant, bundle-scoped, PG-joined results ----------------------
    const q = "How does spacing out my reviews help me remember things long term?";
    const resA = await searchLibraryForLearner(jA.intentId, q);

    check("scoped source count reflects the journey's bound bundle", resA.scopedSourceCount === 1, `count=${resA.scopedSourceCount}`);
    check("learner search returns at least one passage", resA.passages.length > 0, `n=${resA.passages.length}`);
    check(
      "every returned passage is in the journey's provenance scope",
      resA.passages.every((p) => p.sourceId === jA!.sourceId),
      `sources=${[...new Set(resA.passages.map((p) => p.sourceId))].join(",")}`,
    );
    check(
      "top passage is the spaced-repetition chunk (cosine ranks the relevant one first)",
      resA.passages[0]?.preview.toLowerCase().includes("spaced repetition"),
      `top="${resA.passages[0]?.preview.slice(0, 48)}..."`,
    );
    check(
      "citable metadata is joined from Postgres (title present)",
      resA.passages.every((p) => p.source.title === `Verify source ${stamp}-a`),
    );
    check(
      "attribution is non-empty and carries the author name (academic)",
      resA.passages.every((p) => /A\. Tester/.test(p.source.attribution)),
      `attr="${resA.passages[0]?.source.attribution}"`,
    );
    check(
      "every passage is linkable (canonicalUrl or doi from PG)",
      resA.passages.every((p) => Boolean(p.source.canonicalUrl) || Boolean(p.source.doi)),
    );

    // ---- 2. Score floor drops below-threshold hits --------------------------
    check(
      "every returned score clears the floor",
      resA.passages.every((p) => p.score >= LEARNER_SEARCH_SCORE_FLOOR),
      `floor=${LEARNER_SEARCH_SCORE_FLOOR}, min=${Math.min(...resA.passages.map((p) => p.score)).toFixed(3)}`,
    );
    // An off-topic query against the SAME scope: cosine should fall below the
    // floor for these memory passages, so the floor drops them to zero results.
    const offTopic = await searchLibraryForLearner(
      jA.intentId,
      "What is the boiling point of liquid nitrogen at sea level?",
    );
    check(
      "an off-topic query is dropped by the score floor (0 passages despite a non-empty scope)",
      offTopic.scopedSourceCount === 1 && offTopic.passages.length === 0,
      `n=${offTopic.passages.length}`,
    );

    // ---- 3. Scope isolation -------------------------------------------------
    // Journey B is bound only to the volcanology bundle. The memory query must
    // return nothing from B (B cannot see A's sources), even though A's vectors
    // live in the same shared kc_passages collection.
    const bSeesA = await searchLibraryForLearner(jB.intentId, q);
    check(
      "scope isolation: journey B (different bundle) never returns journey A's passages",
      bSeesA.passages.every((p) => p.sourceId === jB!.sourceId),
      `B sources=${[...new Set(bSeesA.passages.map((p) => p.sourceId))].join(",") || "none"}`,
    );
    check(
      "scope isolation: a memory query against the volcanology-only journey clears no relevant hits",
      bSeesA.passages.length === 0,
      `n=${bSeesA.passages.length}`,
    );
    const unboundRes = await searchLibraryForLearner(jUnbound.intentId, q);
    check(
      "an unbound journey resolves an empty scope and returns nothing",
      unboundRes.scopedSourceCount === 0 && unboundRes.passages.length === 0,
      `scope=${unboundRes.scopedSourceCount}, n=${unboundRes.passages.length}`,
    );

    // ---- 4. Deterministic ranking ------------------------------------------
    check(
      "results are sorted by cosine score descending",
      resA.passages.every((p, i) => i === 0 || resA.passages[i - 1].score >= p.score),
    );
    const rerun = await searchLibraryForLearner(jA.intentId, q);
    check(
      "ranking is deterministic across identical reruns (stable order)",
      JSON.stringify(rerun.passages.map((p) => p.chunkId)) ===
        JSON.stringify(resA.passages.map((p) => p.chunkId)),
    );

    // ---- 5. Empty / whitespace query is a safe no-op ------------------------
    const blank = await searchLibraryForLearner(jA.intentId, "   ");
    check("a blank query returns no passages (no embed call)", blank.passages.length === 0);
  } finally {
    if (jA) await teardown(jA);
    if (jB) await teardown(jB);
    if (jUnbound) {
      try {
        await prisma.learningIntent.delete({ where: { id: jUnbound.intentId } });
      } catch {
        // best-effort
      }
    }
    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[verify-learner-search] user cleanup warning: ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n${ok} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

await run();
