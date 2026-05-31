import Link from "next/link";
import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";

// L0.md §7 Q7: a must-acknowledge "we've adjusted your path" notice. No
// auto-redirect -- the learner reads the rationale and explicitly continues.
export default async function AdjustedPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");

  const path = await prisma.learningPath.findUnique({
    where: { intentId: intent.id },
    select: { id: true },
  });
  if (!path) redirect("/journey/goalpost");

  const revision = await prisma.pathRevision.findFirst({
    where: { pathId: path!.id },
    orderBy: { createdAt: "desc" },
  });

  // The PathAdjustment is stored in `changes`; its user-facing `rationale` is
  // the one-liner we surface here.
  const rationale =
    (revision?.changes as { rationale?: string } | null)?.rationale ??
    "We have updated your path so the next steps fit where you are right now.";

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Your path has changed
        </Typography>
        <Typography variant="h3" component="h1">
          We&rsquo;ve adjusted your path
        </Typography>
      </Stack>

      <Card variant="outlined" sx={{ borderColor: "info.main", borderWidth: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              This isn&rsquo;t a setback. When something doesn&rsquo;t land, the
              honest move is to change the plan rather than ask you to keep
              repeating the same step. Here&rsquo;s what we changed and why:
            </Typography>
            <Box
              sx={{
                borderLeft: 4,
                borderColor: "info.main",
                pl: 2,
                py: 0.5,
              }}
            >
              <Typography variant="h6" component="p" sx={{ fontWeight: 400, lineHeight: 1.5 }}>
                {rationale}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Button
        component={Link}
        href="/journey/goalpost"
        variant="contained"
        size="large"
        sx={{ alignSelf: "flex-start" }}
      >
        Got it, continue
      </Button>
    </Stack>
  );
}
