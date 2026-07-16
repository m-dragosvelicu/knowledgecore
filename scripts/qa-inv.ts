/** THROWAWAY QA inventory probe for the E04.S03 gate (PR #14). Deleted after the gate. */
import { prisma } from "@/lib/db";
import { qdrant } from "@/lib/vector/qdrant";
import { KC_PASSAGES } from "@/lib/vector/kcPassages";

const TEST_LABELS = [
  "Home composting of kitchen scraps for beginners",
  "How to brew kombucha at home for beginners",
  "Beginner guide to growing basil indoors",
];

async function main() {
  console.log("=== kc_passages total points ===");
  try {
    const total = await qdrant.count(KC_PASSAGES, { exact: true });
    console.log(`  total = ${total.count}`);
  } catch (e) {
    console.log(`  count error: ${(e as Error).message}`);
  }

  console.log("\n=== ResearchBundle rows matching test topic labels ===");
  const testBundles = await prisma.researchBundle.findMany({
    where: { topicLabel: { in: TEST_LABELS } },
    select: { id: true, topicLabel: true, status: true, progress: true, createdAt: true },
  });
  if (testBundles.length === 0) console.log("  (none)");
  for (const b of testBundles) {
    console.log(`  ${b.id} | ${b.status} | "${b.topicLabel}" | created ${b.createdAt.toISOString()}`);
    console.log(`     progress=${JSON.stringify(b.progress)}`);
  }

  console.log("\n=== Users with qa-e04s03 marker ===");
  const users = await prisma.user.findMany({
    where: { email: { contains: "qa-e04s03" } },
    select: { id: true, email: true, createdAt: true },
  });
  if (users.length === 0) console.log("  (none)");
  for (const u of users) console.log(`  ${u.id} | ${u.email} | created ${u.createdAt.toISOString()}`);

  console.log("\n=== Any other qa/invalid marker users ===");
  const otherUsers = await prisma.user.findMany({
    where: { OR: [{ email: { contains: "qa.invalid" } }, { email: { contains: "@qa." } }] },
    select: { id: true, email: true },
  });
  console.log(`  count = ${otherUsers.length}`);
  for (const u of otherUsers) console.log(`  ${u.id} | ${u.email}`);

  console.log("\n=== Total ResearchBundle rows (all) ===");
  const allBundles = await prisma.researchBundle.count();
  console.log(`  total bundles = ${allBundles}`);
  const recent = await prisma.researchBundle.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, topicLabel: true, status: true, createdAt: true },
  });
  console.log("  --- 12 most recent ---");
  for (const b of recent) {
    console.log(`  ${b.createdAt.toISOString()} | ${b.status.padEnd(11)} | "${b.topicLabel}"`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("INVENTORY ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
