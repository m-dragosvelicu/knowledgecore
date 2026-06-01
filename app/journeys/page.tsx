import Link from "next/link";
import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import type { JourneyStatus } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { prisma, nextWizardRoute } from "@/lib/journey/state";
import AppHeader from "@/components/AppHeader";
import HomeHero from "@/components/HomeHero";
import { Eyebrow, WobbleButton } from "@/components/ui";
import JourneyListRow, { type JourneyListRowData } from "@/components/journey/JourneyListRow";

// Status copy mirrors the home dashboard's one-teal palette: sentence case, the
// difference carried by copy + metadata, never a traffic-light hue.
const STATUS_LABEL: Record<JourneyStatus, string> = {
  created: "Just started",
  goal_assessed: "Setting your goal",
  outcome_assessed: "Defining outcomes",
  knowledge_assessed: "Assessed",
  path_outlined: "Path ready",
  in_progress: "In progress",
  paused: "Paused",
  complete: "Completed",
  abandoned: "Set aside",
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

// Warm relative phrasing for the middot metadata (mirrors the home dashboard).
function relativeWhen(date: Date, now: Date): string {
  const ms = now.getTime() - date.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "opened today";
  if (days === 1) return "opened yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

type IntentRow = {
  id: string;
  rawText: string;
  status: JourneyStatus;
  updatedAt: Date;
  subject: { canonicalName: string } | null;
  path: { goalposts: { status: string; estimatedMinutes: number | null }[] } | null;
};

// Section heading shared by both the active + set-aside groups.
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="h2"
      sx={{
        m: 0,
        mb: "8px",
        fontFamily: "var(--font-display)",
        fontWeight: 500,
        fontSize: 20,
        letterSpacing: "-.01em",
        fontVariationSettings: '"SOFT" 30',
        color: "var(--ink)",
      }}
    >
      {children}
    </Box>
  );
}

// Map a journey row into the design-system row data the client component renders.
function toRowData(intent: IntentRow, now: Date): JourneyListRowData {
  const goalposts = intent.path?.goalposts ?? [];
  const total = goalposts.length;
  const done = goalposts.filter((g) => g.status === "complete").length;
  return {
    id: intent.id,
    title: journeyTitle(intent),
    meta: `${STATUS_LABEL[intent.status]} · ${relativeWhen(intent.updatedAt, now)}`,
    badgeBig: total > 0 ? `${done}/${total}` : intent.status === "complete" ? "Done" : "—",
    badgeSub: total > 0 ? "goalposts" : intent.status === "complete" ? "goalposts" : "not built",
    href: nextWizardRoute(intent as never),
  };
}

const ACTIVE_STATUSES: JourneyStatus[] = [
  "created",
  "goal_assessed",
  "outcome_assessed",
  "knowledge_assessed",
  "path_outlined",
  "in_progress",
  "paused",
];

/**
 * The "all journeys" page reached from the "View all journeys" affordance on the
 * home dashboard. Lists ALL of the signed-in user's journeys using the same
 * design-system journey rows as home, split into the active journey (if any) and
 * everything that has been completed or set aside. Each row carries a quiet
 * overflow delete with a styled confirmation dialog (see JourneyListRow).
 */
export default async function JourneysPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const intents = (await prisma.learningIntent.findMany({
    where: { userId: session.user.id },
    include: {
      subject: true,
      path: {
        include: {
          goalposts: { select: { status: true, estimatedMinutes: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  })) as unknown as IntentRow[];

  const now = new Date();
  const active = intents.find((i) => ACTIVE_STATUSES.includes(i.status));
  const past = intents.filter((i) => i.id !== active?.id);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "transparent", position: "relative", zIndex: 2 }}>
      <AppHeader />

      <Box
        component="main"
        sx={{
          maxWidth: 1060,
          mx: "auto",
          px: { xs: "22px", sm: "40px" },
          pb: { xs: "80px", sm: "100px" },
        }}
      >
        <Box className="kc-fade" sx={{ mb: "26px", animationDelay: ".06s" }}>
          <Eyebrow sx={{ mb: "12px" }}>Your library</Eyebrow>
          <Box
            component="h1"
            sx={{
              m: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 400,
              fontSize: "clamp(34px, 4.4vw, 48px)",
              lineHeight: 1.06,
              letterSpacing: "-.02em",
              fontVariationSettings: '"SOFT" 20, "opsz" 144',
              color: "var(--ink)",
            }}
          >
            All your journeys
          </Box>
          <Box sx={{ mt: "8px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}>
            Everything you have started, finished, or set aside.
          </Box>
        </Box>

        {intents.length === 0 ? (
          // No journeys at all — fall back to the hero entry point.
          <Box className="kc-fade" sx={{ mt: "10px", animationDelay: ".16s" }}>
            <HomeHero />
          </Box>
        ) : (
          <>
            {active && (
              <Box className="kc-fade" sx={{ mb: "40px", animationDelay: ".16s" }}>
                <SectionTitle>In progress</SectionTitle>
                <Box sx={{ borderTop: "1px solid var(--line)" }}>
                  <JourneyListRow data={toRowData(active, now)} />
                </Box>
              </Box>
            )}

            {past.length > 0 && (
              <Box className="kc-fade" sx={{ animationDelay: ".24s" }}>
                <SectionTitle>Finished and set aside</SectionTitle>
                <Box sx={{ borderTop: "1px solid var(--line)" }}>
                  {past.map((intent) => (
                    <JourneyListRow key={intent.id} data={toRowData(intent, now)} />
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}

        <Box className="kc-fade" sx={{ mt: "32px", animationDelay: ".3s" }}>
          <Box component={Link} href="/" sx={{ textDecoration: "none", display: "inline-flex" }}>
            <WobbleButton bare>Back to home</WobbleButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
