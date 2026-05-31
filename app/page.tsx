import Link from "next/link";
import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import type { JourneyStatus } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { prisma, nextWizardRoute } from "@/lib/journey/state";
import { startNewJourneyAction } from "@/app/(app)/journey/_actions";
import AppHeader from "@/components/AppHeader";

const ACTIVE_STATUSES: JourneyStatus[] = [
  "created",
  "goal_assessed",
  "outcome_assessed",
  "knowledge_assessed",
  "path_outlined",
  "in_progress",
  "paused",
];

const STATUS_META: Record<JourneyStatus, { label: string; color: "default" | "info" | "warning" | "success" }> = {
  created: { label: "Just started", color: "info" },
  goal_assessed: { label: "Setting your goal", color: "info" },
  outcome_assessed: { label: "Defining outcomes", color: "info" },
  knowledge_assessed: { label: "Assessed", color: "info" },
  path_outlined: { label: "Path ready", color: "info" },
  in_progress: { label: "In progress", color: "warning" },
  paused: { label: "Paused", color: "warning" },
  complete: { label: "Completed", color: "success" },
  abandoned: { label: "Abandoned", color: "default" },
};

function journeyTitle(intent: {
  rawText: string;
  subject: { canonicalName: string } | null;
}): string {
  return (
    intent.subject?.canonicalName ||
    (intent.rawText.trim().length > 0 ? intent.rawText.trim() : "Untitled journey")
  );
}

export default async function HomePage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const intents = await prisma.learningIntent.findMany({
    where: { userId: session.user.id },
    include: {
      subject: true,
      path: { include: { goalposts: { select: { status: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const active = intents.find((i) => ACTIVE_STATUSES.includes(i.status));
  const past = intents.filter((i) => i.id !== active?.id);
  const firstName = session.user.name?.split(" ")[0];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppHeader />
      <Container maxWidth="md" sx={{ py: 5 }}>
        <Stack spacing={4}>
          <Box>
            <Typography variant="h3" component="h1">
              {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Pick up where you left off, or start something new.
            </Typography>
          </Box>

          {/* Continue the active journey, if any */}
          {active ? (
            <Card variant="outlined" sx={{ borderColor: "primary.main", borderWidth: 2 }}>
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      label={STATUS_META[active.status].label}
                      color={STATUS_META[active.status].color}
                    />
                    <Typography variant="caption" color="text.secondary">
                      updated {active.updatedAt.toLocaleDateString()}
                    </Typography>
                  </Stack>
                  <Typography variant="h5" component="h2">
                    {journeyTitle(active)}
                  </Typography>
                  <Button
                    component={Link}
                    href={nextWizardRoute(active)}
                    variant="contained"
                    size="large"
                    sx={{ alignSelf: "flex-start" }}
                  >
                    Continue this journey
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2} alignItems="flex-start">
                  <Typography variant="body1">
                    You have no journey in progress.
                  </Typography>
                  <form action={startNewJourneyAction}>
                    <Button type="submit" variant="contained" size="large">
                      Start a new journey
                    </Button>
                  </form>
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Past journeys */}
          {past.length > 0 && (
            <Box>
              <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                Your journeys
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                {past.map((intent) => {
                  const total = intent.path?.goalposts.length ?? 0;
                  const done =
                    intent.path?.goalposts.filter((g) => g.status === "complete").length ?? 0;
                  return (
                    <Card key={intent.id} variant="outlined">
                      <CardContent sx={{ py: 2 }}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          spacing={2}
                        >
                          <Box>
                            <Typography variant="subtitle1">{journeyTitle(intent)}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {total > 0 && `${done}/${total} goalposts · `}
                              {intent.updatedAt.toLocaleDateString()}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            label={STATUS_META[intent.status].label}
                            color={STATUS_META[intent.status].color}
                          />
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            </Box>
          )}

          {/* Start new is always available as a secondary action when a journey is active */}
          {active && (
            <Box>
              <form action={startNewJourneyAction}>
                <Button type="submit" variant="text">
                  Start a different journey
                </Button>
              </form>
              <Typography variant="caption" color="text.secondary">
                Starting a new journey sets aside the one in progress.
              </Typography>
            </Box>
          )}
        </Stack>
      </Container>
    </Box>
  );
}
