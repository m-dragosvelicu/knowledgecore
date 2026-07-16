"use client";

// Account gate: create-account / sign-in form (landing-flow plan 3b). Email +
// password only (no social/OAuth, per project rule; D5 keeps email
// verification off).
//
// On success, onLinkAccount re-owns the anonymous journey server-side; we then
// mount ResearchFillWait, which fires acceptPathAction() to accept, activate
// goalpost 1, fill the research bundle on a cache MISS, and redirect. The
// shared T3 ladder (E04.S03) takes over once a poll reports a running fill.
// On failure the journey stays untouched (still anonymous).

import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { authClient } from "@/lib/auth-client";
import { PillTextField } from "@/components/ui";
import SolidButton from "@/components/ui/SolidButton";
import ResearchFillWait from "@/components/journey/wait/ResearchFillWait";

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
  // True once auth succeeds; mounts ResearchFillWait to resume the begin flow.
  const [resuming, setResuming] = useState(false);

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
            setResuming(true);
          },
          onError: (ctx: { error: { message: string } }) => onError(ctx.error.message),
        },
      );
    } else {
      await authClient.signIn.email(
        { email: email.trim(), password },
        {
          onSuccess: () => {
            setResuming(true);
          },
          onError: (ctx: { error: { message: string } }) => onError(ctx.error.message),
        },
      );
    }
  }

  const isCreate = mode === "create";

  const form = (
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

  if (!resuming) return form;
  // Account created — hand off to the shared research ladder. The form (with
  // its pending button) stays up until a poll reports a running fill, so an
  // instant cache HIT redirects without ever flashing the ladder.
  return <ResearchFillWait intentId={intentId}>{form}</ResearchFillWait>;
}
