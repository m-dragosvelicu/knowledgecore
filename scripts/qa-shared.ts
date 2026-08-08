/** THROWAWAY QA shared-source safety probe. Deleted after the gate. */
import { prisma } from "@/lib/db";

async function main() {
  const bundleId = process.argv[2];
  const links = await prisma.bundleSourceLink.findMany({
    where: { bundleId },
    select: { sourceId: true },
  });
  const sourceIds = links.map((l) => l.sourceId);
  console.log(`bundle ${bundleId} has ${sourceIds.length} sources`);
  for (const sid of sourceIds) {
    const bundleLinks = await prisma.bundleSourceLink.findMany({
      where: { sourceId: sid },
      select: { bundleId: true },
    });
    const shared = bundleLinks.filter((b) => b.bundleId !== bundleId);
    console.log(
      `  source ${sid}: linked to ${bundleLinks.length} bundle(s)` +
        (shared.length > 0 ? `  *** SHARED with ${shared.map((s) => s.bundleId).join(",")} ***` : "  (exclusive)"),
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
