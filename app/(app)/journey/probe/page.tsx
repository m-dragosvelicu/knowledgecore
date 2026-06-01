import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import { getServices } from "@/lib/services";
import type { CanDoStatement } from "@/lib/services/types";
import { Eyebrow } from "@/components/ui";
import ProbeClient from "./ProbeClient";

export default async function ProbePage({
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
  const outcome = await prisma.expectedOutcome.findUnique({ where: { intentId: intent.id } });
  if (!subject || !outcome) redirect(`/journey/outcome?j=${intent.id}`);

  const services = getServices();
  const canDo = outcome!.canDoStatements as unknown as CanDoStatement[];
  const questions = await services.knowledgeProbe.questions(
    { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    canDo,
  );

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Box className="kc-fade" sx={{ mb: "30px", animationDelay: ".04s" }}>
        <Eyebrow sx={{ mb: "12px" }}>Finding your starting point</Eyebrow>
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
          A few quick questions
        </Box>
        <Box
          component="p"
          sx={{ mt: "12px", fontSize: 15.5, lineHeight: 1.55, color: "var(--ink-2)" }}
        >
          Just enough to calibrate where your trail begins. There&rsquo;s no
          score here, and a blank or unsure answer tells us just as much.
        </Box>
      </Box>

      <Box className="kc-fade" sx={{ animationDelay: ".12s" }}>
        <ProbeClient questions={questions} intentId={intent.id} />
      </Box>
    </Box>
  );
}
