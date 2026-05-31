import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import SubmitButton from "@/components/journey/SubmitButton";
import MicTextField from "@/components/journey/MicTextField";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";
import {
  confirmIntentAction,
  submitIntentAction,
} from "@/app/(app)/journey/_actions";
import { getCurrentSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";

type SearchParams = Promise<{ confirm?: string; note?: string }>;

export default async function IntentPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);

  // -----------------------------------------------------------------------
  // Confirm / refine sub-view (L0.md §3 Stage 2 ambiguity surfacing). Shown
  // only when submitIntentAction parsed an ambiguous intent and bounced back
  // here with ?confirm=1. The parser's best interpretation was already saved as
  // the Subject; the learner either accepts it or refines their wording. We do
  // NOT silently narrow on their behalf.
  // -----------------------------------------------------------------------
  const subject = intent
    ? await prisma.subject.findUnique({ where: { intentId: intent.id } })
    : null;

  if (params.confirm === "1" && subject) {
    const clarification =
      params.note ??
      "That could mean a few different things. Does the reading below match what you had in mind?";
    return (
      <Box sx={{ maxWidth: 720 }}>
        <Box className="kc-fade" sx={{ animationDelay: ".04s" }}>
          <Eyebrow sx={{ mb: "16px" }}>Setting your direction</Eyebrow>
          <Box
            component="h1"
            sx={{
              m: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 400,
              fontSize: "clamp(30px, 4vw, 44px)",
              lineHeight: 1.08,
              letterSpacing: "-.02em",
              fontVariationSettings: '"SOFT" 20, "opsz" 144',
              color: "var(--ink)",
            }}
          >
            Let&rsquo;s make sure we&rsquo;ve got this{" "}
            <HeadlineUnderline>
              <Box
                component="span"
                sx={{ color: "var(--teal)", fontStyle: "italic", fontWeight: 500 }}
              >
                right
              </Box>
            </HeadlineUnderline>
          </Box>
          <Box
            component="p"
            sx={{ mt: "14px", fontSize: 15.5, lineHeight: 1.55, color: "var(--ink-2)" }}
          >
            {clarification}
          </Box>
        </Box>

        {/* Our reading of the intent, as a quiet surface card with an eyebrow. */}
        <Box
          className="kc-fade"
          sx={{
            mt: "26px",
            bgcolor: "background.paper",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-sm)",
            p: "22px 26px",
            animationDelay: ".12s",
          }}
        >
          <Eyebrow sx={{ mb: "8px" }}>Our reading of your intent</Eyebrow>
          <Box
            sx={{
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              fontSize: 24,
              lineHeight: 1.2,
              color: "var(--ink)",
            }}
          >
            {subject.canonicalName}
          </Box>
          <Box
            sx={{ mt: "8px", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-2)" }}
          >
            {subject.scopeNote}
          </Box>
        </Box>

        <Box className="kc-fade" sx={{ mt: "22px", animationDelay: ".18s" }}>
          {/* Accept the interpretation as-is and proceed. */}
          <form action={confirmIntentAction}>
            <SubmitButton
              variant="contained"
              size="large"
              pendingLabel="Setting your direction…"
            >
              Yes, that&rsquo;s right
            </SubmitButton>
          </form>
        </Box>

        <Box
          className="kc-fade"
          sx={{ mt: "30px", animationDelay: ".24s" }}
        >
          <Eyebrow sx={{ mb: "10px" }}>Not quite?</Eyebrow>
          <Box
            component="p"
            sx={{ mb: "14px", fontSize: 14.5, color: "var(--ink-2)" }}
          >
            Refine it below and we&rsquo;ll read it again.
          </Box>
          <form action={submitIntentAction}>
            <Stack spacing={2} alignItems="flex-start">
              <MicTextField
                name="rawText"
                label="Refine your learning intent"
                placeholder="e.g., classical mechanics for a first-year physics course"
                multiline
                minRows={3}
                required
                fullWidth
                defaultValue={intent?.rawText ?? ""}
              />
              <SubmitButton
                variant="outlined"
                size="large"
                pendingLabel="Reading your intent…"
              >
                Read it again
              </SubmitButton>
            </Stack>
          </form>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 760 }}>
      {/* Hero question, mirroring the Slice 2 home hero: eyebrow, Fraunces at the
          light weight, the expressive words in italic accent-teal with the
          self-drawing underline, then a fade-up stagger down the section. */}
      <Box className="kc-fade" sx={{ animationDelay: ".04s" }}>
        <Eyebrow sx={{ mb: "16px" }}>A few questions first</Eyebrow>
        <Box
          component="h1"
          sx={{
            m: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: "clamp(34px, 5vw, 56px)",
            lineHeight: 1.05,
            letterSpacing: "-.02em",
            fontVariationSettings: '"SOFT" 20, "opsz" 144',
            color: "var(--ink)",
          }}
        >
          What do you want to{" "}
          <HeadlineUnderline>
            <Box
              component="span"
              sx={{ color: "var(--teal)", fontStyle: "italic", fontWeight: 500 }}
            >
              actually learn?
            </Box>
          </HeadlineUnderline>
        </Box>
      </Box>

      <Box
        component="p"
        className="kc-fade"
        sx={{
          mt: "16px",
          fontSize: 15.5,
          lineHeight: 1.55,
          color: "var(--ink-2)",
          animationDelay: ".1s",
        }}
      >
        Describe the topic in your own words. We&rsquo;ll use this to set your
        direction for the rest of the journey.
      </Box>

      <Box
        className="kc-fade"
        sx={{ mt: "28px", animationDelay: ".16s" }}
      >
        <form action={submitIntentAction}>
          <Stack spacing={1.5} alignItems="flex-start">
            <MicTextField
              name="rawText"
              label="Your learning intent"
              placeholder="Try: linear algebra basics for machine learning"
              multiline
              minRows={3}
              required
              fullWidth
              defaultValue={intent?.rawText ?? ""}
            />
            <Box
              component="p"
              sx={{ m: 0, pl: "4px", fontSize: 13, color: "var(--ink-3)" }}
            >
              Tip · try &ldquo;linear algebra basics for machine learning&rdquo;
              to see the rich pre-baked example.
            </Box>
            <SubmitButton
              variant="contained"
              size="large"
              pendingLabel="Reading your intent…"
              sx={{ mt: "6px" }}
            >
              Continue
            </SubmitButton>
          </Stack>
        </form>
      </Box>
    </Box>
  );
}
