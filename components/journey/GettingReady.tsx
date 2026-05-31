"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";

type Props = {
  goalpostId: string;
  title: string;
  /**
   * Server action that generates (Call B) and persists this goalpost's lesson
   * content against the freshest learner profile. Idempotent.
   */
  action: (goalpostId: string) => Promise<void>;
};

/**
 * L1 LAZY GENERATION — the "getting things ready" screen.
 *
 * Shown when a learner enters a goalpost whose lesson content has not yet been
 * generated (Call B). On mount it invokes the server action to author the
 * profile-adapted content, then refreshes the route so the page re-renders with
 * the ready lesson. The common case is pre-generated on advance, so this screen
 * is brief or skipped entirely; it is the honest cover for the first goalpost and
 * any pre-generation miss.
 */
export default function GettingReady({ goalpostId, title, action }: Props) {
  const router = useRouter();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await action(goalpostId);
        if (!cancelled) router.refresh();
      } catch {
        if (!cancelled) {
          setError("We could not prepare this lesson just now.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [action, goalpostId, router]);

  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 4, md: 6 }, bgcolor: "background.paper", borderRadius: "var(--r-lg)" }}
    >
      <Stack spacing={3} alignItems="center" textAlign="center">
        {error ? (
          <>
            <Alert severity="warning" sx={{ width: "100%" }}>
              {error}
            </Alert>
            <Button
              variant="contained"
              onClick={() => {
                startedRef.current = false;
                setError(null);
                router.refresh();
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <>
            <CircularProgress />
            <Typography variant="h6" component="p">
              Getting things ready…
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Tailoring &ldquo;{title}&rdquo; to where you are right now.
            </Typography>
          </>
        )}
      </Stack>
    </Paper>
  );
}
