import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent } from "@/lib/journey/state";
import { getServices } from "@/lib/services";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Alert from "@mui/material/Alert";
import type { JourneyStatus } from "@prisma/client";
import AppHeader from "@/components/AppHeader";

const STEPS: Array<{ label: string; statuses: JourneyStatus[] }> = [
  { label: "Intent", statuses: ["created"] },
  { label: "Outcome", statuses: ["goal_assessed"] },
  { label: "Probe", statuses: ["outcome_assessed"] },
  { label: "Path", statuses: ["knowledge_assessed", "path_outlined"] },
  { label: "Learn", statuses: ["in_progress", "paused", "complete"] },
];

function statusToStep(status: JourneyStatus | undefined): number {
  if (!status) return 0;
  const idx = STEPS.findIndex((s) => s.statuses.includes(status));
  return idx === -1 ? 0 : idx;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  // No session: send to the landing hero (public entry + guest bootstrap),
  // not the bare sign-in tabs. This layout wraps both public pre-journey
  // routes and gated ones; per-page guards + middleware protect the latter.
  if (!session?.user?.id) {
    redirect("/");
  }
  const intent = await getOrCreateActiveIntent(session.user.id);
  const activeStep = statusToStep(intent?.status);
  // The "Learn" group (in_progress/paused/complete) is only ever reached via
  // acceptPathAction, which sets path.acceptedAt in the same call -- so
  // reaching that group IS the acceptance signal (path/page.tsx:80's
  // `acceptedAt != null` gate), with no extra query. Once the active
  // journey's path is accepted, the wizard funnel is done: the stepper drops
  // off every learn-phase surface and every funnel route revisited for that
  // journey (e.g. /journey/path shown again to review the trail). A fresh,
  // not-yet-accepted journey is a different LearningIntent row, so it starts
  // back at step 0 and shows the stepper again.
  const showStepper = activeStep < STEPS.length - 1;
  const { mode } = getServices();

  return (
    // Transparent + raised so the fixed bone/grain/dot-grid backdrop shows
    // through; content stacks above the texture layers.
    <Box sx={{ minHeight: "100vh", bgcolor: "transparent", position: "relative", zIndex: 2 }}>
      <AppHeader />

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={4}>
          {mode === "mock" && (
            // Restyled onto the one-teal palette (no info-blue): a quiet teal-soft
            // note carried by copy, not a traffic-light color.
            <Alert
              icon={false}
              severity="info"
              sx={{
                bgcolor: "var(--teal-soft)",
                color: "var(--teal-deep)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-md)",
                "& .MuiAlert-message": { fontSize: 14 },
              }}
            >
              Running in mock mode. Responses are placeholder content, not live
              LLM generation. Mock mode can be on because no GOOGLE_GENAI_API_KEY
              is set, or because a service has been opted out via a LIVE_* flag.
            </Alert>
          )}

          {showStepper && (
            <Stepper activeStep={activeStep} alternativeLabel>
              {STEPS.map((step) => (
                <Step key={step.label}>
                  <StepLabel>{step.label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          )}

          <Box>{children}</Box>
        </Stack>
      </Container>
    </Box>
  );
}
