import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import { Eyebrow } from "@/components/ui";
import OutcomeClient from "./OutcomeClient";

export default async function OutcomePage({
  searchParams,
}: {
  searchParams?: Promise<{ j?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/"); // public pre-journey route; guests allowed
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");
  const subject = await prisma.subject.findUnique({ where: { intentId: intent.id } });
  if (!subject) redirect("/journey/intent");
  const goal = await prisma.learningGoal.findUnique({ where: { intentId: intent.id } });

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Box className="kc-fade" sx={{ mb: "32px", animationDelay: ".04s" }}>
        <Eyebrow sx={{ mb: "12px" }}>Your subject</Eyebrow>
        <Box
          component="h1"
          sx={{
            m: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: "clamp(30px, 4.4vw, 48px)",
            lineHeight: 1.06,
            letterSpacing: "-.02em",
            fontVariationSettings: '"SOFT" 20, "opsz" 144',
            color: "var(--ink)",
          }}
        >
          {subject.canonicalName}
        </Box>
        <Box
          component="p"
          sx={{ mt: "10px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}
        >
          {subject.scopeNote}
        </Box>
      </Box>

      <Box className="kc-fade" sx={{ animationDelay: ".12s" }}>
        <OutcomeClient defaultMotivation={goal?.motivation ?? null} />
      </Box>
    </Box>
  );
}
