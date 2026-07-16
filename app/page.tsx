import Link from "next/link";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { JourneyStatus } from "@prisma/client";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nextWizardRoute } from "@/lib/journey/intent/routing";
import { startNewJourneyAction } from "@/app/(app)/journey/_actions";
import AppHeader from "@/components/AppHeader";
import HomeHero from "@/components/HomeHero";
import HowItWorks from "@/components/HowItWorks";
import {
  FeaturedCard,
  SolidButton,
  WobbleButton,
  Eyebrow,
  SectionLabel,
  HeadlineUnderline,
  ScoreBadge,
} from "@/components/ui";

const ACTIVE_STATUSES: JourneyStatus[] = [
  "created",
  "goal_assessed",
  "outcome_assessed",
  "knowledge_assessed",
  "path_outlined",
  "in_progress",
  "paused",
];

// Status copy on the one-teal palette: sentence case, no second hue. The visual
// difference is carried by ink weight + the middot metadata, not a traffic-light
// color. "Abandoned" is softened to "set aside".
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

// Warm relative phrasing for the middot metadata ("opened today", "opened
// yesterday", "4 days ago"). Sentence case, second person, no emoji.
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

// A single journey row: title + middot metadata on the left, a roughened score
// badge (n of m goalposts, or a score for a completed journey) on the right.
// Hover nudges the row right and warms the title to teal-deep (CSS only).
function JourneyRow({ intent, now }: { intent: IntentRow; now: Date }) {
  const goalposts = intent.path?.goalposts ?? [];
  const total = goalposts.length;
  const done = goalposts.filter((g) => g.status === "complete").length;
  const meta = `${STATUS_LABEL[intent.status]} · ${relativeWhen(intent.updatedAt, now)}`;

  return (
    <Box
      component={Link}
      href={nextWizardRoute(intent as never)}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "24px",
        py: "22px",
        px: "4px",
        borderBottom: "1px solid var(--line)",
        cursor: "pointer",
        textDecoration: "none",
        color: "inherit",
        transition: "padding-left .2s",
        "&:hover": { pl: "12px" },
        "&:hover .kc-row-title": { color: "var(--teal-deep)" },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box
          className="kc-row-title"
          sx={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: 20,
            letterSpacing: "-.01em",
            fontVariationSettings: '"SOFT" 30',
            color: "var(--ink)",
            transition: "color .2s",
          }}
        >
          {journeyTitle(intent)}
        </Box>
        <Box sx={{ mt: "5px", fontSize: 13, color: "var(--ink-3)" }}>{meta}</Box>
      </Box>

      <Box sx={{ flex: "none" }}>
        {/* These badges show goalpost PROGRESS, not a genuine score, so they
            render un-circled (ring={false}). The roughened score ellipse is
            reserved for real checkpoint scores (trail, complete page). */}
        {intent.status === "complete" ? (
          <ScoreBadge big={total > 0 ? `${done}/${total}` : "Done"} sub="goalposts" ring={false} />
        ) : (
          <ScoreBadge
            big={total > 0 ? `${done}/${total}` : "—"}
            sub={total > 0 ? "goalposts" : "not built"}
            ring={false}
          />
        )}
      </Box>
    </Box>
  );
}

export default async function HomePage() {
  const session = await getCurrentSession();
  const hasRealAccount = !!session?.user?.id && !isAnonymousSession(session);

  // Public landing (landing-flow plan 1c): a visitor with no real account
  // (no session, or an anonymous guest session) sees the start-a-journey
  // hero. HomeHero lazily bootstraps a guest session on submit.
  if (!hasRealAccount) {
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
          <HomeHero />
          <HowItWorks />
          <Box
            className="kc-fade"
            sx={{ mt: "40px", fontSize: 13.5, color: "var(--ink-3)", animationDelay: ".34s" }}
          >
            Already have an account?{" "}
            <Box
              component={Link}
              href="/signin"
              sx={{
                color: "var(--teal-deep)",
                textDecoration: "none",
                fontWeight: 600,
                "&:hover": { textDecoration: "underline" },
              }}
            >
              Sign in
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  const intents = (await prisma.learningIntent.findMany({
    where: { userId: session!.user.id },
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

  // Featured-card side stat: remaining goalposts + an estimated time to the next
  // checkpoint, derived from the path the active journey already has (if any).
  const activeGoalposts = active?.path?.goalposts ?? [];
  const remaining = activeGoalposts.filter((g) => g.status !== "complete");
  const nextEtaMin = remaining[0]?.estimatedMinutes ?? null;

  return (
    // Above the fixed bone/grain/dot-grid backdrop; centered single column,
    // max-width 1060px, generous padding to match the shared chrome.
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
        {active ? (
          // ---- Returning user with an active journey: welcome-back dashboard ----
          <>
            <Stack
              className="kc-fade"
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "flex-start", sm: "center" }}
              justifyContent="space-between"
              spacing="14px"
              sx={{ mb: "14px", animationDelay: ".06s" }}
            >
              <Box
                component="h2"
                sx={{
                  m: 0,
                  fontFamily: "var(--font-display)",
                  fontWeight: 500,
                  fontSize: 25,
                  letterSpacing: "-.01em",
                  fontVariationSettings: '"SOFT" 30',
                  color: "var(--ink)",
                }}
              >
                Pick up where you left off
              </Box>

              {/* Workbench (wobble) tier with a resting outline so it reads as a
                  real, obvious affordance. The form runs startNewJourneyAction,
                  which sets aside the journey in progress. */}
              <Box
                component="form"
                action={startNewJourneyAction}
                sx={{ display: "inline-flex", flex: "none" }}
              >
                <WobbleButton type="submit">Start a new journey</WobbleButton>
              </Box>
            </Stack>

            <Box
              className="kc-fade"
              sx={{ mb: "14px", fontSize: 12.5, color: "var(--ink-3)", animationDelay: ".1s" }}
            >
              Starting a new journey keeps your others intact.
            </Box>

            <Box className="kc-fade" sx={{ mb: { xs: "44px", sm: "66px" }, animationDelay: ".16s" }}>
              <FeaturedCard
                side={
                  <>
                    <Box>
                      <SectionLabel sx={{ mb: "12px" }}>your trail so far</SectionLabel>
                      <Box sx={{ fontSize: 13, color: "var(--ink-2)" }}>
                        {activeGoalposts.length > 0
                          ? `${activeGoalposts.filter((g) => g.status === "complete").length} of ${activeGoalposts.length} goalposts cleared`
                          : "your path is still building"}
                      </Box>
                    </Box>
                    <Box>
                      <Box
                        sx={{
                          fontFamily: "var(--font-display)",
                          fontSize: 27,
                          fontVariationSettings: '"SOFT" 30',
                          color: "var(--ink)",
                        }}
                      >
                        {nextEtaMin != null ? `~${nextEtaMin} min` : "next up"}
                      </Box>
                      <Box sx={{ mt: "2px", fontSize: 12.5, color: "var(--ink-3)" }}>
                        to the next checkpoint
                      </Box>
                    </Box>
                  </>
                }
              >
                <Eyebrow>{STATUS_LABEL[active.status]}</Eyebrow>
                <Box sx={{ position: "relative", display: "inline-block", my: "14px" }}>
                  <HeadlineUnderline>
                    <Box
                      component="h3"
                      sx={{
                        m: 0,
                        fontFamily: "var(--font-display)",
                        fontWeight: 400,
                        fontSize: 33,
                        lineHeight: 1.08,
                        letterSpacing: "-.01em",
                        fontVariationSettings: '"SOFT" 20',
                        color: "var(--ink)",
                      }}
                    >
                      {journeyTitle(active)}
                    </Box>
                  </HeadlineUnderline>
                </Box>
                <Box
                  component="p"
                  sx={{ m: 0, maxWidth: "94%", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}
                >
                  You have a journey in progress. Carry on from where you stopped, or
                  open the full path to see what is ahead.
                </Box>
                <Stack direction="row" alignItems="center" spacing="10px" sx={{ mt: "28px", flexWrap: "wrap" }}>
                  <Box component={Link} href={nextWizardRoute(active as never)} sx={{ textDecoration: "none" }}>
                    <SolidButton tone="teal">Resume</SolidButton>
                  </Box>
                  <Box component={Link} href={nextWizardRoute(active as never)} sx={{ textDecoration: "none", display: "inline-flex" }}>
                    <WobbleButton>See the full path</WobbleButton>
                  </Box>
                </Stack>
              </FeaturedCard>
            </Box>

            {past.length > 0 && (
              <Box className="kc-fade" sx={{ animationDelay: ".3s" }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ mb: "14px" }}
                >
                  <Box
                    component="h2"
                    sx={{
                      m: 0,
                      fontFamily: "var(--font-display)",
                      fontWeight: 500,
                      fontSize: 25,
                      letterSpacing: "-.01em",
                      fontVariationSettings: '"SOFT" 30',
                      color: "var(--ink)",
                    }}
                  >
                    Your journeys
                  </Box>
                  <Box component={Link} href="/journeys" sx={{ textDecoration: "none", display: "inline-flex" }}>
                    <WobbleButton bare>View all journeys</WobbleButton>
                  </Box>
                </Stack>
                <Box sx={{ borderTop: "1px solid var(--line)" }}>
                  {past.map((intent) => (
                    <JourneyRow key={intent.id} intent={intent} now={now} />
                  ))}
                </Box>
              </Box>
            )}
          </>
        ) : (
          // ---- No active journey: the hero question is the entry point ----
          <>
            <HomeHero />

            {past.length > 0 && (
              <Box className="kc-fade" sx={{ animationDelay: ".22s" }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ mb: "14px" }}
                >
                  <Box
                    component="h2"
                    sx={{
                      m: 0,
                      fontFamily: "var(--font-display)",
                      fontWeight: 500,
                      fontSize: 25,
                      letterSpacing: "-.01em",
                      fontVariationSettings: '"SOFT" 30',
                      color: "var(--ink)",
                    }}
                  >
                    Your journeys
                  </Box>
                  <Box component={Link} href="/journeys" sx={{ textDecoration: "none", display: "inline-flex" }}>
                    <WobbleButton bare>View all journeys</WobbleButton>
                  </Box>
                </Stack>
                <Box sx={{ borderTop: "1px solid var(--line)" }}>
                  {past.map((intent) => (
                    <JourneyRow key={intent.id} intent={intent} now={now} />
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
