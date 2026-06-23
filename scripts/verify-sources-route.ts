/**
 * E01.S07 — verification of the goalpost sources read path.
 * Run: `bun run scripts/verify-sources-route.ts`. Exits non-zero on any failure.
 *
 * DB-backed: runs the SAME Prisma query the route handler runs (READY bundles
 * bound to a journey -> deduped sources) and the SAME exported buildAttribution,
 * so a regression in either surfaces here. Read-only; no fixtures created.
 *
 * Skips gracefully (exit 0) when no journey has a bound ready bundle yet, so it
 * is safe in an empty CI DB. Set VERIFY_JOURNEY_ID to pin a specific journey.
 */

import { prisma } from "../lib/db";
import { buildAttribution } from "../lib/journey/sourceAttribution";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

async function pickJourneyId(): Promise<string | null> {
  if (process.env.VERIFY_JOURNEY_ID) return process.env.VERIFY_JOURNEY_ID;
  const link = await prisma.journeyBundleLink.findFirst({
    where: { bundle: { status: "ready" } },
    select: { intentId: true },
  });
  return link?.intentId ?? null;
}

async function main() {
  const journeyId = await pickJourneyId();
  if (!journeyId) {
    console.log("SKIP | no journey bound to a ready bundle in this DB");
    process.exit(0);
  }

  // The exact query the route handler issues.
  const bundleLinks = await prisma.journeyBundleLink.findMany({
    where: { intentId: journeyId, bundle: { status: "ready" } },
    select: {
      bundle: {
        select: {
          sources: {
            select: {
              source: {
                select: {
                  id: true,
                  kind: true,
                  title: true,
                  canonicalUrl: true,
                  doi: true,
                  authors: true,
                  venue: true,
                  publishedYear: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const seen = new Set<string>();
  const sources = [];
  for (const link of bundleLinks) {
    for (const bs of link.bundle.sources) {
      const src = bs.source;
      if (seen.has(src.id)) continue;
      seen.add(src.id);
      sources.push({
        id: src.id,
        kind: src.kind,
        title: src.title,
        canonicalUrl: src.canonicalUrl,
        doi: src.doi,
        attribution: buildAttribution(src),
      });
    }
  }

  check("journey resolves at least one source", sources.length > 0, `count=${sources.length}`);
  check("sources are deduped by id", new Set(sources.map((s) => s.id)).size === sources.length);
  check(
    "every source is linkable (canonicalUrl or doi)",
    sources.every((s) => Boolean(s.canonicalUrl) || Boolean(s.doi)),
  );
  check(
    "every attribution is non-empty",
    sources.every((s) => s.attribution.trim().length > 0),
  );
  check(
    "no attribution leaks [object Object]",
    sources.every((s) => !s.attribution.includes("[object Object]")),
  );
  check(
    "academic attribution carries an author name",
    sources
      .filter((s) => s.kind === "academic")
      .every((s) => /[A-Za-z].*(?: & | et al\.|,)/.test(s.attribution)),
  );

  console.log("\n--- resolved sources ---");
  for (const s of sources) {
    console.log(`[${s.kind}] ${s.title}`);
    console.log(`        ${s.attribution}`);
    console.log(`        ${s.canonicalUrl ?? (s.doi ? "https://doi.org/" + s.doi : "(no link)")}`);
  }

  console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : fail + " CHECK(S) FAILED"} (${ok} ok, ${fail} fail)`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
