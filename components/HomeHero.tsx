"use client";

// KnowledgeCore — home hero (the kit's signature question), shown on the empty
// state and as the entry to starting a journey when there is no active journey.
//
// "What do you want to actually know?" set in Fraunces, with the italic teal
// accent on the expressive words ("actually know") and the self-drawing
// underline beneath them, plus the pill input with the teal focus ring. The
// section fades up on load (staggered via .kc-fade + a delay).
//
// The SearchPill manages its own text; we mirror it into a hidden input inside
// a real <form> bound to startJourneyWithIntentAction so submit starts a fresh
// journey carrying the typed intent (server action, progressive-enhancement
// friendly). Mirrors design-system/ui_kits/web-app/Home.jsx (the hero section).

import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import { SearchPill, HeadlineUnderline, Eyebrow } from "@/components/ui";
import { startJourneyWithIntentAction } from "@/app/(app)/journey/_actions";

export default function HomeHero() {
  const [intent, setIntent] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Box
      component="section"
      className="kc-fade"
      sx={{ maxWidth: 800, mb: { xs: "44px", sm: "62px" }, animationDelay: ".06s" }}
    >
      <Eyebrow sx={{ mb: "18px" }}>Information + experience = knowledge</Eyebrow>

      <Box
        component="h1"
        sx={{
          m: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: "clamp(38px, 5.3vw, 62px)",
          lineHeight: 1.04,
          letterSpacing: "-.02em",
          fontVariationSettings: '"SOFT" 20, "opsz" 144',
          color: "var(--ink)",
        }}
      >
        What do you want to
        <br />
        <HeadlineUnderline>
          <Box
            component="span"
            sx={{ color: "var(--teal)", fontStyle: "italic", fontWeight: 500 }}
          >
            actually know?
          </Box>
        </HeadlineUnderline>
      </Box>

      <Box
        component="form"
        ref={formRef}
        action={startJourneyWithIntentAction}
        sx={{ mt: "36px" }}
      >
        <input type="hidden" name="rawText" value={intent} />
        <SearchPill
          value={intent}
          onChange={setIntent}
          onSubmit={(v) => {
            if (v.trim().length >= 3) formRef.current?.requestSubmit();
          }}
          placeholder="Try: the ideas behind Art Nouveau"
          cta="Begin"
        />
      </Box>

      <Box
        component="p"
        sx={{ mt: "15px", pl: "6px", fontSize: 13.5, color: "var(--ink-3)" }}
      >
        A few questions first, then your path builds itself.
      </Box>
    </Box>
  );
}
