"use client";

// The SearchPill is a self-contained <form> (its design contract; it is reused
// standalone). The hero must NOT wrap it in a second <form> — that nests
// <form> inside <form>, which React rejects with a hydration error and then
// regenerates the tree, dropping the submit wiring (so "Begin" did nothing).
// Instead we drive submission from SearchPill's onSubmit: lazily mint a guest,
// then call the startJourneyWithIntentAction server action programmatically with
// a constructed FormData (the same client-invokes-server-action pattern as
// BeginClient). Mirrors design-system/ui_kits/web-app/Home.jsx (the hero section).

import { useState } from "react";
import Box from "@mui/material/Box";
import { SearchPill, HeadlineUnderline, Eyebrow } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { startJourneyWithIntentAction } from "@/app/(app)/journey/_actions";

export default function HomeHero() {
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);

  // First-visit bootstrap (landing-flow plan, section 2a): a visitor with no
  // session gets a guest (anonymous) session the moment they actually submit the
  // hero — NOT on page render, so bots/crawlers that only load the page never
  // mint a guest user. With a session already present (guest or real) the
  // anonymous call is skipped. We only call the server action once an owner
  // exists, so startJourneyWithIntentAction's ownerContext resolves a userId
  // instead of bouncing to /signin.
  async function ensureSessionThenSubmit(text: string) {
    const rawText = text.trim();
    if (rawText.length < 3 || busy) return;
    setBusy(true);
    try {
      const current = await authClient.getSession();
      if (!current?.data?.session) {
        await authClient.signIn.anonymous();
      }
    } catch {
      // If the guest bootstrap fails we still submit: the server action will
      // redirect to /signin, which is a safe, honest fallback.
    }
    try {
      const formData = new FormData();
      formData.set("rawText", rawText);
      // Server action redirects on success (into the wizard); control does not
      // return here in the happy path. A thrown NEXT_REDIRECT is expected and
      // handled by the framework, so it is not caught.
      await startJourneyWithIntentAction(formData);
    } finally {
      setBusy(false);
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

      <Box sx={{ mt: "36px" }}>
        <SearchPill
          value={intent}
          onChange={setIntent}
          onSubmit={(v) => {
            void ensureSessionThenSubmit(v);
          }}
          disabled={busy}
          pending={busy}
          pendingLabel="Reading your intent…"
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
