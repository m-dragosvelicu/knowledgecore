"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

type Mode = "signin" | "signup";

function SignInInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSuccess = () => {
    setSubmitting(false);
    router.push(callbackUrl);
    router.refresh();
  };

  const onError = (message: string) => {
    setSubmitting(false);
    setError(message);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (mode === "signup") {
      await authClient.signUp.email(
        { name: name.trim() || email, email, password },
        {
          onSuccess,
          onError: (ctx) => onError(ctx.error.message),
        }
      );
    } else {
      await authClient.signIn.email(
        { email, password },
        {
          onSuccess,
          onError: (ctx) => onError(ctx.error.message),
        }
      );
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Card>
        <CardContent>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h5" component="h1" gutterBottom>
                {mode === "signin"
                  ? "Sign in to KnowledgeCore"
                  : "Create your KnowledgeCore account"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Access your learning journey.
              </Typography>
            </Box>

            <Tabs
              value={mode}
              onChange={(_, value: Mode) => {
                setMode(value);
                setError(null);
              }}
              variant="fullWidth"
            >
              <Tab value="signin" label="Sign in" />
              <Tab value="signup" label="Create account" />
            </Tabs>

            {error && <Alert severity="error">{error}</Alert>}

            <form onSubmit={handleSubmit}>
              <Stack spacing={2}>
                {mode === "signup" && (
                  <TextField
                    name="name"
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    fullWidth
                    autoComplete="name"
                  />
                )}
                <TextField
                  name="email"
                  type="email"
                  label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  fullWidth
                  required
                  autoComplete="email"
                />
                <TextField
                  name="password"
                  type="password"
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  required
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  helperText={
                    mode === "signup" ? "At least 8 characters." : undefined
                  }
                />
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={submitting}
                >
                  {mode === "signin" ? "Sign in" : "Create account"}
                </Button>
              </Stack>
            </form>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
