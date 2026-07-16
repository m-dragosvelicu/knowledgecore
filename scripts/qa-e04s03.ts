/**
 * THROWAWAY QA harness for the E04.S03 research-fill ladder gate (PR #14).
 * Drives the REAL production entry bindJourneyBundle (exactly what
 * acceptPathAction calls) and concurrently samples readBundleProgressForIntent
 * (exactly what readBundleProgressAction returns) every ~500ms.
 * Deleted after the gate. Not product code.
 */
import { prisma } from "@/lib/db";
import {
  bindJourneyBundle,
  readBundleProgressForIntent,
} from "@/lib/journey/researchBundle";
import { fingerprint, type OutcomeShape } from "@/lib/research/fingerprint";
import { qdrant } from "@/lib/vector/qdrant";
import { KC_PASSAGES } from "@/lib/vector/kcPassages";

const MARKER = "qa-e04s03";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CanDo = { text: string; bloomLevel: string };

async function seedJourney(
  canonicalName: string,
  canDo: CanDo[],
  tag: string,
): Promise<{ userId: string; intentId: string; fp: string }> {
  const user = await prisma.user.create({
    data: {
      email: `${MARKER}-${tag}-${Date.now()}@qa.invalid`,
      name: `${MARKER} ${tag}`,
      emailVerified: true,
      isAnonymous: false,
    },
  });
  const intent = await prisma.learningIntent.create({
    data: { userId: user.id, rawText: `${MARKER} ${canonicalName}`, status: "path_outlined" },
  });
  await prisma.subject.create({
    data: { intentId: intent.id, canonicalName, scopeNote: `${MARKER} scope` },
  });
  await prisma.expectedOutcome.create({
    data: {
      intentId: intent.id,
      canDoStatements: canDo as unknown as object,
      successCriterion: `${MARKER} success`,
    },
  });
  const fp = fingerprint(canonicalName, canDo as unknown as OutcomeShape);
  return { userId: user.id, intentId: intent.id, fp };
}

async function countPointsForBundle(bundleId: string): Promise<number> {
  try {
    const res = await qdrant.count(KC_PASSAGES, {
      filter: { must: [{ key: "bundleIds", match: { value: bundleId } }] },
      exact: true,
    });
    return res.count;
  } catch (e) {
    return -1;
  }
}

async function rawBundle(fp: string) {
  const b = await prisma.researchBundle.findUnique({
    where: { topicFingerprint: fp },
    select: {
      id: true,
      status: true,
      progress: true,
      embeddingModel: true,
      embeddingDim: true,
    },
  });
  return b;
}

async function chunkCountForBundle(bundleId: string): Promise<number> {
  const links = await prisma.bundleSourceLink.findMany({
    where: { bundleId },
    select: { source: { select: { _count: { select: { chunks: true } } } } },
  });
  return links.reduce((n, l) => n + l.source._count.chunks, 0);
}

// ---- concurrent cold fill + sampler ----
async function coldFillWithSampling(
  canonicalName: string,
  canDo: CanDo[],
  goalpostQueries: string[],
  tag: string,
): Promise<void> {
  const { intentId, fp } = await seedJourney(canonicalName, canDo, tag);
  console.log(`\n[${tag}] intent=${intentId} fp=${fp}`);
  console.log(`[${tag}] topicLabel="${canonicalName}"`);

  const samples: string[] = [];
  let lastKey = "";
  let sampling = true;
  const t0 = Date.now();

  const sampler = (async () => {
    while (sampling) {
      try {
        const s = await readBundleProgressForIntent(intentId);
        if (s) {
          const key = `${s.stage}|${s.done}|${s.total}|${s.status}`;
          if (key !== lastKey) {
            lastKey = key;
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            samples.push(
              `  t=${dt}s  stage=${s.stage.padEnd(9)} done=${s.done} total=${s.total} status=${s.status}  "${s.label}"`,
            );
          }
        }
      } catch (e) {
        /* poll errors are non-fatal to the sampler */
      }
      await sleep(500);
    }
  })();

  const startFill = Date.now();
  const bundleId = await bindJourneyBundle({
    intentId,
    topicFingerprint: fp,
    topicLabel: canonicalName,
    goalpostQueries,
  });
  const fillMs = Date.now() - startFill;

  // catch the terminal state a few more times
  for (let i = 0; i < 4; i++) {
    const s = await readBundleProgressForIntent(intentId);
    if (s) {
      const key = `${s.stage}|${s.done}|${s.total}|${s.status}`;
      if (key !== lastKey) {
        lastKey = key;
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        samples.push(
          `  t=${dt}s  stage=${s.stage.padEnd(9)} done=${s.done} total=${s.total} status=${s.status}  "${s.label}"`,
        );
      }
    }
    await sleep(300);
  }
  sampling = false;
  await sampler;

  console.log(`[${tag}] --- observed distinct progress sequence (via poll) ---`);
  for (const line of samples) console.log(line);
  console.log(`[${tag}] bindJourneyBundle returned: ${bundleId} (fill wall ${fillMs}ms)`);

  const raw = await rawBundle(fp);
  console.log(`[${tag}] RAW bundle row:`);
  console.log(`  id=${raw?.id}`);
  console.log(`  status=${raw?.status}`);
  console.log(`  embeddingModel=${raw?.embeddingModel} embeddingDim=${raw?.embeddingDim}`);
  console.log(`  progress(raw json)=${JSON.stringify(raw?.progress)}`);
  if (raw?.id) {
    const chunks = await chunkCountForBundle(raw.id);
    const points = await countPointsForBundle(raw.id);
    console.log(`  chunks(persisted)=${chunks}  kc_passages(points for bundle)=${points}`);
  }
}

// ---- cache hit: same fingerprint, fresh intent ----
async function cacheHit(
  canonicalName: string,
  canDo: CanDo[],
  goalpostQueries: string[],
  tag: string,
): Promise<void> {
  const { intentId, fp } = await seedJourney(canonicalName, canDo, tag);
  console.log(`\n[${tag}] intent=${intentId} fp=${fp} (expecting HIT)`);

  const samples: string[] = [];
  let lastKey = "";
  let sampling = true;
  const t0 = Date.now();
  const sampler = (async () => {
    while (sampling) {
      try {
        const s = await readBundleProgressForIntent(intentId);
        if (s) {
          const key = `${s.stage}|${s.done}|${s.total}|${s.status}`;
          if (key !== lastKey) {
            lastKey = key;
            const dt = ((Date.now() - t0) / 1000).toFixed(2);
            samples.push(`  t=${dt}s  stage=${s.stage} status=${s.status} "${s.label}"`);
          }
        }
      } catch {}
      await sleep(120);
    }
  })();

  const start = Date.now();
  const bundleId = await bindJourneyBundle({
    intentId,
    topicFingerprint: fp,
    topicLabel: canonicalName,
    goalpostQueries,
  });
  const ms = Date.now() - start;
  // one more poll to see terminal
  await sleep(200);
  sampling = false;
  await sampler;

  console.log(`[${tag}] --- observed distinct progress sequence ---`);
  for (const line of samples) console.log(line);
  console.log(`[${tag}] bindJourneyBundle returned ${bundleId} in ${ms}ms (near-instant == HIT)`);
  const runningObserved = samples.some((s) => s.includes("status=running"));
  console.log(`[${tag}] RUNNING window observed by poll? ${runningObserved} (want: false -> ladder never flashes)`);
}

async function cleanup(): Promise<void> {
  console.log("[cleanup] purging qa-e04s03 artifacts...");
  // Test bundles by topicLabel (the four fresh topics used in this gate).
  const labels = [
    "Home composting of kitchen scraps for beginners",
    "How to brew kombucha at home for beginners",
    "Beginner guide to growing basil indoors",
  ];
  const bundles = await prisma.researchBundle.findMany({
    where: { topicLabel: { in: labels } },
    select: { id: true },
  });
  const bundleIds = bundles.map((b) => b.id);
  console.log(`[cleanup] test bundles: ${bundleIds.length}`);

  // Sources reachable only from these test bundles.
  const links = await prisma.bundleSourceLink.findMany({
    where: { bundleId: { in: bundleIds } },
    select: { sourceId: true },
  });
  const sourceIds = [...new Set(links.map((l) => l.sourceId))];

  // Qdrant points for these bundles.
  let purgedPoints = 0;
  for (const bid of bundleIds) {
    try {
      await qdrant.delete(KC_PASSAGES, {
        wait: true,
        filter: { must: [{ key: "bundleIds", match: { value: bid } }] },
      });
      purgedPoints++;
    } catch (e) {
      console.log(`[cleanup] qdrant delete for ${bid}: ${(e as Error).message}`);
    }
  }

  // Delete the graph: chunks -> sources -> links -> journeyLinks -> bundles.
  await prisma.sourceChunk.deleteMany({ where: { sourceId: { in: sourceIds } } });
  await prisma.bundleSourceLink.deleteMany({ where: { bundleId: { in: bundleIds } } });
  await prisma.journeyBundleLink.deleteMany({ where: { bundleId: { in: bundleIds } } });
  await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
  await prisma.researchBundle.deleteMany({ where: { id: { in: bundleIds } } });

  // Delete test users (cascades intents -> subjects/outcomes).
  const del = await prisma.user.deleteMany({
    where: { email: { contains: MARKER } },
  });
  console.log(
    `[cleanup] deleted ${sourceIds.length} sources, ${bundleIds.length} bundles, ${del.count} users; qdrant filters cleared for ${purgedPoints} bundles`,
  );

  // Report residual kc_passages total.
  try {
    const total = await qdrant.count(KC_PASSAGES, { exact: true });
    console.log(`[cleanup] kc_passages total points now: ${total.count}`);
  } catch (e) {
    console.log(`[cleanup] kc_passages count: ${(e as Error).message}`);
  }
}

async function main() {
  const cmd = process.argv[2];

  const compostName = "Home composting of kitchen scraps for beginners";
  const compostCanDo: CanDo[] = [
    { text: "Explain what composting is and why it works", bloomLevel: "understand" },
    { text: "Describe how to start a compost bin at home", bloomLevel: "apply" },
  ];
  const compostQ = [
    "Explain what composting is and why it works",
    "How to start a compost bin at home",
    "A beginner guide to balancing greens and browns",
  ];

  const kombuchaName = "How to brew kombucha at home for beginners";
  const kombuchaCanDo: CanDo[] = [
    { text: "Explain what kombucha is and how fermentation makes it", bloomLevel: "understand" },
    { text: "Describe the steps to brew a first batch at home", bloomLevel: "apply" },
  ];
  const kombuchaQ = [
    "Explain what kombucha is for a beginner",
    "How to brew a first batch of kombucha at home",
    "A simple guide to a kombucha SCOBY",
  ];

  const basilName = "Beginner guide to growing basil indoors";
  const basilCanDo: CanDo[] = [
    { text: "Explain what basil needs to grow indoors", bloomLevel: "understand" },
    { text: "Describe how to plant and water indoor basil", bloomLevel: "apply" },
  ];
  const basilQ = [
    "Explain what basil needs to grow indoors for a beginner",
    "How to plant basil indoors step by step",
    "A simple guide to watering indoor herbs",
  ];

  if (cmd === "check1") {
    console.log(`TAVILY present? ${!!process.env.TAVILY_API_KEY}`);
    await coldFillWithSampling(compostName, compostCanDo, compostQ, "check1-coldfill");
  } else if (cmd === "check2") {
    await cacheHit(compostName, compostCanDo, compostQ, "check2-cachehit");
  } else if (cmd === "check3") {
    console.log(`TAVILY present? ${!!process.env.TAVILY_API_KEY} (Qdrant should be DOWN for this run)`);
    await coldFillWithSampling(kombuchaName, kombuchaCanDo, kombuchaQ, "check3-ingestdegrade");
  } else if (cmd === "check4") {
    console.log(`TAVILY present? ${!!process.env.TAVILY_API_KEY} (want: false -> fill fails fast)`);
    await coldFillWithSampling(basilName, basilCanDo, basilQ, "check4-fillfailure");
  } else if (cmd === "cleanup") {
    await cleanup();
  } else {
    console.log("usage: bun run scripts/qa-e04s03.ts <check1|check2|check3|check4|cleanup>");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
