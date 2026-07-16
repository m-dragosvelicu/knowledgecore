import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrCreateActiveIntent } from "@/lib/journey/intent/resolution";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";
import BeginClient from "./BeginClient";

// Account gate (landing-flow plan 3b): reached when acceptPathAction rejects
// an anonymous guest (requireRealUserId) and redirects here. Deliberately not
// a bounce to the stock /signin tabs — it's the next step, framed as "save
// your path and begin". On success onLinkAccount re-owns the journey and the
// client resumes acceptPathAction, landing the learner in goalpost 1.
export default async function BeginPage({
  searchParams,
}: {
  searchParams?: Promise<{ j?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();

  // A real account that somehow lands here just proceeds into goalpost 1.
  if (session?.user?.id && !isAnonymousSession(session)) {
    redirect("/journey/goalpost");
  }
  // No session at all: nothing to claim; start from the landing hero.
  if (!session?.user?.id) {
    redirect("/");
  }

  // Guest path: summarise the journey they are about to commit to.
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");
  const j = intent.id;

  const [subject, path] = await Promise.all([
    prisma.subject.findUnique({ where: { intentId: intent.id } }),
    prisma.learningPath.findUnique({
      where: { intentId: intent.id },
      include: { goalposts: { select: { estimatedMinutes: true } } },
    }),
  ]);
  // The gate only makes sense once the path overview exists; otherwise send the
  // guest back to finish the public flow.
  if (!subject || !path) redirect(`/journey/path?j=${j}`);

  const goalpostCount = path.goalposts.length;
  const totalMinutes = path.goalposts.reduce(
    (sum, g) => sum + (g.estimatedMinutes ?? 0),
    0,
  );

  return (
    <Box sx={{ maxWidth: 560, mx: "auto" }}>
      <Box className="kc-fade" sx={{ animationDelay: ".04s" }}>
        <Eyebrow sx={{ mb: "16px" }}>Save your path and begin</Eyebrow>
        <Box
          component="h1"
          sx={{
            m: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: "clamp(30px, 4.4vw, 46px)",
            lineHeight: 1.06,
            letterSpacing: "-.02em",
            fontVariationSettings: '"SOFT" 20, "opsz" 144',
            color: "var(--ink)",
          }}
        >
          You are ready to{" "}
          <HeadlineUnderline>
            <Box
              component="span"
              sx={{ color: "var(--teal)", fontStyle: "italic", fontWeight: 500 }}
            >
              start learning
            </Box>
          </HeadlineUnderline>
        </Box>
        <Box
          component="p"
          sx={{ mt: "16px", fontSize: 15.5, lineHeight: 1.55, color: "var(--ink-2)" }}
        >
          Create an account to keep the path you just built and begin the first
          goalpost. Your work so far comes with you.
        </Box>
      </Box>

      {/* Restate the commitment so the value is visible at this moment. */}
      <Box
        className="kc-fade"
        sx={{
          mt: "24px",
          bgcolor: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          p: "20px 24px",
          animationDelay: ".1s",
        }}
      >
        <Box
          sx={{
            fontFamily: "var(--font-display)",
            fontVariationSettings: '"SOFT" 30',
            fontWeight: 500,
            fontSize: 22,
            lineHeight: 1.2,
            color: "var(--ink)",
          }}
        >
          {subject.canonicalName}
        </Box>
        <Box sx={{ mt: "6px", fontSize: 14, color: "var(--ink-3)" }}>
          {goalpostCount} {goalpostCount === 1 ? "goalpost" : "goalposts"}
          {totalMinutes > 0 ? ` · ~${totalMinutes} min to the finish` : ""}
        </Box>
      </Box>

      <Stack className="kc-fade" sx={{ mt: "28px", animationDelay: ".16s" }}>
        <BeginClient intentId={intent.id} />
      </Stack>
    </Box>
  );
}
