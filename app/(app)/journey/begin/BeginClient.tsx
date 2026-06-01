"use client";

// THE ACCOUNT GATE — create-account / sign-in form (landing-flow plan 3b).
//
// Email + password only (no social / OAuth, per project rule; D5 keeps email
// verification off so the account is usable immediately). Two verbs in one
// place: "create account & begin" (primary) and a quieter "I already have an
// account" sign-in (secondary), because a returning visitor might run the public
// flow before realising they are already a customer.
//
// Flow on success: the auth call's response carries the new real session AND
// fires the server-side onLinkAccount hook, which atomically re-owns the
// anonymous journey (lib/auth.ts -> claimAnonymousJourney). We then resume the
// exact pending action by calling acceptPathAction(), which now sees a real
// account, stamps accept, activates goalpost 1, and redirects to
// /journey/goalpost. On failure (e.g. email taken) we stay here with the error;
// the journey is untouched (still anonymous), so the learner can retry or switch
// to sign-in.
//
// Design system: Fraunces is owned by the page heading; here we use the themed
// pill inputs (teal focus ring) + the solid commit button, on the one-teal
// vocabulary. No native browser dialogs.

import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { authClient } from "@/lib/auth-client";
import { acceptPathAction } from "@/app/(app)/journey/_actions";
import { PillTextField } from "@/components/ui";
import SolidButton from "@/components/ui/SolidButton";

type Mode = "create" | "signin";

type Props = {
  // The resolved journey id (from ?j). The id is stable across the account
  // claim (the row is re-owned, not recreated), so the resumed acceptPathAction
  // operates on the journey the guest actually built.
  intentId: string;
};

export default function BeginClient({ intentId }: Props) {
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // After auth succeeds (and the claim hook has re-owned the journey), resume
  // the pending begin. acceptPathAction redirects on success, so control does
  // not return here in the happy path.
  async function resumeBegin() {
    await acceptPathAction(intentId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8 && mode === "create") {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setSubmitting(true);

    const onError = (message: string) => {
      setSubmitting(false);
      setError(message);
    };

    if (mode === "create") {
      await authClient.signUp.email(
        { name: name.trim() || email, email: email.trim(), password },
        {
          onSuccess: () => {
            // Keep submitting=true through the resume redirect.
            void resumeBegin();
          },
          onError: (ctx: { error: { message: string } }) => onError(ctx.error.message),
        },
      );
    } else {
      await authClient.signIn.email(
        { email: email.trim(), password },
        {
          onSuccess: () => {
            void resumeBegin();
          },
          onError: (ctx: { error: { message: string } }) => onError(ctx.error.message),
        },
      );
    }
  }

  const isCreate = mode === "create";

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>
        {error && (
          <Box
            role="alert"
            sx={{
              bgcolor: "var(--teal-soft)",
              color: "var(--teal-deep)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              p: "12px 16px",
              fontSize: 14,
            }}
          >
            {error}
          </Box>
        )}

        {isCreate && (
          <PillTextField
            name="name"
            label="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoComplete="name"
          />
        )}

        <PillTextField
          name="email"
          type="email"
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          required
          autoComplete="email"
        />

        <PillTextField
          name="password"
          type="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          required
          autoComplete={isCreate ? "new-password" : "current-password"}
          helperText={isCreate ? "At least 8 characters." : undefined}
        />

        <Box sx={{ pt: "4px" }}>
          <SolidButton type="submit" tone="teal" disabled={submitting} arrow>
            {submitting
              ? isCreate
                ? "Creating your account…"
                : "Signing you in…"
              : isCreate
                ? "Create account and begin"
                : "Sign in and begin"}
          </SolidButton>
        </Box>

        <Box sx={{ pt: "8px", fontSize: 13.5, color: "var(--ink-3)" }}>
          {isCreate ? "Already have an account? " : "Need a new account? "}
          <Box
            component="button"
            type="button"
            onClick={() => {
              setMode(isCreate ? "signin" : "create");
              setError(null);
            }}
            sx={{
              p: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--teal-deep)",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {isCreate ? "Sign in instead" : "Create one instead"}
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
