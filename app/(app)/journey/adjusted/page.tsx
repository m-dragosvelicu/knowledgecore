import Link from "next/link";
import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { GATE_REDIRECT } from "@/lib/auth-guards";
import { prisma } from "@/lib/db";
import { getOrCreateActiveIntent } from "@/lib/journey/intent/resolution";
import SolidButton from "@/components/ui/SolidButton";
import SaveAndLeaveRow from "@/components/journey/SaveAndLeave";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";

// L0.md §7 Q7: a must-acknowledge "we've adjusted your path" notice. No
// auto-redirect -- the learner reads the rationale and explicitly continues.
export default async function AdjustedPage({
  searchParams,
}: {
  searchParams?: Promise<{ j?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");

  const path = await prisma.learningPath.findUnique({
    where: { intentId: intent.id },
    select: { id: true },
  });
  if (!path) redirect(`/journey/goalpost?j=${intent.id}`);

  const revision = await prisma.pathRevision.findFirst({
    where: { pathId: path!.id },
    orderBy: { createdAt: "desc" },
  });

  // The PathAdjustment is stored in `changes`; its user-facing `rationale` is
  // the one-liner we surface here.
  const rationale =
    (revision?.changes as { rationale?: string } | null)?.rationale ??
    "We have updated your trail so the next steps fit where you are right now.";

  return (
    <Stack spacing={4}>
      <Stack spacing={1.5}>
        <Eyebrow>Your trail has changed</Eyebrow>
        <HeadlineUnderline>
          <Typography variant="h3" component="h1">
            We&rsquo;ve reshaped your trail
          </Typography>
        </HeadlineUnderline>
      </Stack>

      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          p: { xs: "28px 24px", md: "40px 48px" },
        }}
      >
        <Stack spacing={2.5}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: "60ch", lineHeight: 1.6 }}
          >
            This isn&rsquo;t a setback. When something doesn&rsquo;t land, the
            honest move is to change the plan rather than ask you to keep
            repeating the same step. Here&rsquo;s what we changed and why.
          </Typography>
          <Box
            sx={{
              borderLeft: "3px solid var(--teal)",
              pl: "16px",
            }}
          >
            <Typography
              variant="h6"
              component="p"
              sx={{ fontWeight: 400, lineHeight: 1.5, maxWidth: "58ch" }}
            >
              {rationale}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <SaveAndLeaveRow>
        <SolidButton
          component={Link}
          href={`/journey/goalpost?j=${intent.id}`}
          tone="ink"
          size="large"
        >
          Got it, continue
        </SolidButton>
      </SaveAndLeaveRow>
    </Stack>
  );
}
