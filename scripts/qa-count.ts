/** THROWAWAY QA count probe for the E04.S03 gate. Deleted after the gate. */
import { prisma } from "@/lib/db";
import { qdrant } from "@/lib/vector/qdrant";
import { KC_PASSAGES } from "@/lib/vector/kcPassages";

async function pointsForBundle(bundleId: string): Promise<number> {
  const res = await qdrant.count(KC_PASSAGES, {
    filter: { must: [{ key: "bundleIds", match: { value: bundleId } }] },
    exact: true,
  });
  return res.count;
}

async function main() {
  const bundleId = process.argv[2];
  if (!bundleId) {
    console.log("usage: bun run scripts/qa-count.ts <bundleId>");
    await prisma.$disconnect();
    return;
  }
  const links = await prisma.bundleSourceLink.findMany({
    where: { bundleId },
    select: { sourceId: true, source: { select: { _count: { select: { chunks: true } } } } },
  });
  const chunks = links.reduce((n, l) => n + l.source._count.chunks, 0);
  console.log(`bundle ${bundleId}: ${links.length} sources, ${chunks} chunks`);
  console.log(`kc_passages points for bundle = ${await pointsForBundle(bundleId)}`);
  const total = await qdrant.count(KC_PASSAGES, { exact: true });
  console.log(`kc_passages total = ${total.count}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
