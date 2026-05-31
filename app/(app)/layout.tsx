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
  if (!session?.user?.id) {
    redirect("/signin");
  }
  const intent = await getOrCreateActiveIntent(session.user.id);
  const activeStep = statusToStep(intent?.status);
  const { mode } = getServices();

  return (
    // Transparent + raised so the fixed bone/grain/dot-grid backdrop shows
    // through; content stacks above the texture layers.
    <Box sx={{ minHeight: "100vh", bgcolor: "transparent", position: "relative", zIndex: 2 }}>
      <AppHeader />

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={4}>
          {mode === "mock" && (
            <Alert severity="info">
              Running in mock mode. Add GOOGLE_GENAI_API_KEY in .env to enable
              live LLM generation.
            </Alert>
          )}

          <Stepper activeStep={activeStep} alternativeLabel>
            {STEPS.map((step) => (
              <Step key={step.label}>
                <StepLabel>{step.label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Box>{children}</Box>
        </Stack>
      </Container>
    </Box>
  );
}
