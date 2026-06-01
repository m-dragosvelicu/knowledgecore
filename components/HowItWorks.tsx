// KnowledgeCore — the public landing "how it works" strip.
//
// A thin, calm row under the hero on the unauthenticated landing: the five
// pre-journey stages a visitor can run before committing (intent -> goal ->
// outcome -> probe -> your path), then "begin". Sentence case, second person,
// domain vocabulary; no emoji, no em/en dashes. Reuses the design-system
// primitives + tokens (Eyebrow, Fraunces, --line/--ink/--teal) — no new design
// language. Server component (static copy only).

import Box from "@mui/material/Box";
import { Eyebrow } from "@/components/ui";

const STEPS: Array<{ n: string; label: string; note: string }> = [
  { n: "1", label: "Say what you want", note: "describe it in your own words" },
  { n: "2", label: "Set your goal", note: "a short interview shapes it" },
  { n: "3", label: "Name the outcome", note: "what you will be able to do" },
  { n: "4", label: "Show what you know", note: "a quick knowledge probe" },
  { n: "5", label: "See your path", note: "a trail built just for you" },
];

export default function HowItWorks() {
  return (
    <Box
      component="section"
      className="kc-fade"
      sx={{ mt: { xs: "8px", sm: "20px" }, animationDelay: ".22s" }}
    >
      <Eyebrow sx={{ mb: "18px" }}>How it works</Eyebrow>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(5, 1fr)" },
          gap: { xs: "14px", sm: "10px" },
          borderTop: "1px solid var(--line)",
          pt: "24px",
        }}
      >
        {STEPS.map((s) => (
          <Box key={s.n} sx={{ minWidth: 0 }}>
            <Box
              aria-hidden
              sx={{
                width: 30,
                height: 30,
                mb: "12px",
                borderRadius: "50%",
                border: "1px solid var(--line)",
                display: "grid",
                placeContent: "center",
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 15,
                fontVariationSettings: '"SOFT" 30',
                color: "var(--teal-deep)",
              }}
            >
              {s.n}
            </Box>
            <Box
              sx={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 16.5,
                letterSpacing: "-.01em",
                fontVariationSettings: '"SOFT" 30',
                color: "var(--ink)",
              }}
            >
              {s.label}
            </Box>
            <Box sx={{ mt: "4px", fontSize: 13, lineHeight: 1.45, color: "var(--ink-3)" }}>
              {s.note}
            </Box>
          </Box>
        ))}
      </Box>

      <Box
        sx={{ mt: "20px", fontSize: 13.5, color: "var(--ink-2)", maxWidth: "62ch" }}
      >
        You can do all of this without an account. You only create one when you
        are ready to begin learning, and your half-built path comes with you.
      </Box>
    </Box>
  );
}
