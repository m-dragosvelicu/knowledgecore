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
import { authClient } from "@/lib/auth-client";
import { startJourneyWithIntentAction } from "@/app/(app)/journey/_actions";

export default function HomeHero() {
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // First-visit bootstrap (landing-flow plan, section 2a): a visitor with no
  // session gets a guest (anonymous) session the moment they actually submit the
  // hero — NOT on page render, so bots/crawlers that only load the page never
  // mint a guest user. With a session already present (guest or real) the
  // anonymous call is skipped. We only submit the server action once an owner
  // exists, so startJourneyWithIntentAction's ownerContext resolves a userId
  // instead of bouncing to /signin.
  async function ensureSessionThenSubmit(text: string) {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      const current = await authClient.getSession();
      if (!current?.data?.session) {
        await authClient.signIn.anonymous();
      }
    } catch {
      // If the guest bootstrap fails we still submit: the server action will
      // redirect to /signin, which is a safe, honest fallback.
    } finally {
      setBusy(false);
      formRef.current?.requestSubmit();
    }
  }

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
            void ensureSessionThenSubmit(v);
          }}
          disabled={busy}
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
