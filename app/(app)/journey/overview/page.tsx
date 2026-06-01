import Link from "next/link";
import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import SaveAndLeaveRow from "@/components/journey/SaveAndLeave";
import type { CanDoStatement } from "@/lib/services/types";

// B.6 §1.0 (net-new): the Journey Overview -- the journey-level threshold shown
// conceptually after path acceptance, before the first goalpost. It recouples
// intent with plan: what we understood, what you'll do, the total time. The
// "that's not quite right" correction is, per the design, a conversation rather
// than hand-editing -- in L0 we keep it minimal: a link back to revisit the
// intent/path with a one-line note. No path hand-editing is implemented.
export default async function OverviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ j?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");

  const [subject, outcome, path] = await Promise.all([
    prisma.subject.findUnique({ where: { intentId: intent.id } }),
    prisma.expectedOutcome.findUnique({ where: { intentId: intent.id } }),
    prisma.learningPath.findUnique({
      where: { intentId: intent.id },
      include: { goalposts: { orderBy: { order: "asc" } } },
    }),
  ]);

  if (!subject) redirect("/journey/intent");
  if (!path) redirect("/journey/path");

  const canDoStatements =
    (outcome?.canDoStatements as unknown as CanDoStatement[]) ?? [];
  const goalposts = path!.goalposts;
  const totalMinutes = goalposts.reduce((sum, gp) => sum + gp.estimatedMinutes, 0);

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
          Your journey
        </Typography>
        <Typography variant="h3" component="h1">
          {subject!.canonicalName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Before we begin, here&rsquo;s what we understood and what you&rsquo;ll do.
        </Typography>
      </Stack>

      {/* What we understood */}
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="overline" color="text.secondary">
              What we understood you want
            </Typography>
            {subject!.scopeNote && (
              <Typography variant="body1">{subject!.scopeNote}</Typography>
            )}
            {canDoStatements.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  By the end, you&rsquo;ll be able to:
                </Typography>
                <Stack spacing={1.25} component="ul" sx={{ pl: 0, listStyle: "none", m: 0 }}>
                  {canDoStatements.map((cd, i) => (
                    <Stack
                      key={i}
                      component="li"
                      direction="row"
                      spacing={1.5}
                      alignItems="flex-start"
                    >
                      <Box
                        aria-hidden
                        component="svg"
                        viewBox="0 0 24 24"
                        width={18}
                        height={18}
                        sx={{
                          mt: 0.4,
                          flexShrink: 0,
                          fill: "none",
                          stroke: "currentColor",
                          strokeWidth: 2.5,
                          color: "success.main",
                        }}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </Box>
                      <Typography variant="body1">{cd.text}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* What you'll do */}
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ flexWrap: "wrap" }}>
              <Typography variant="overline" color="text.secondary">
                What you&rsquo;ll do
              </Typography>
              <Chip
                label={`${goalposts.length} goalposts`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`~${totalMinutes} min total`}
                size="small"
                variant="outlined"
              />
            </Stack>
            <Stack spacing={1.25} component="ol" sx={{ pl: 0, listStyle: "none", m: 0 }}>
              {goalposts.map((gp) => (
                <Stack
                  key={gp.id}
                  component="li"
                  direction="row"
                  spacing={1.5}
                  alignItems="baseline"
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ minWidth: 24, fontVariantNumeric: "tabular-nums" }}
                  >
                    {gp.order}.
                  </Typography>
                  <Typography variant="body1" sx={{ flex: 1 }}>
                    {gp.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ~{gp.estimatedMinutes} min
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={2}>
        <SaveAndLeaveRow>
          <Button
            component={Link}
            href="/journey/goalpost"
            variant="contained"
            size="large"
          >
            Start learning
          </Button>
        </SaveAndLeaveRow>
        <Typography variant="body2" color="text.secondary">
          Not quite what you meant?{" "}
          <Box
            component={Link}
            href="/journey/path"
            sx={{ color: "primary.main", textDecoration: "underline" }}
          >
            Revisit your path
          </Box>{" "}
          to take another look. (In this version, adjustments happen as you learn
          rather than by editing the plan by hand.)
        </Typography>
      </Stack>
    </Stack>
  );
}
