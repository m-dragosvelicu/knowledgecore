"use client";

import { useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Collapse from "@mui/material/Collapse";
import Box from "@mui/material/Box";
import SubmitButton from "@/components/journey/SubmitButton";

type Props = {
  goalpostId: string;
  // The resolved journey id (from ?j), submitted as a hidden field so the skip
  // mutates and advances the journey the learner actually opened.
  intentId: string;
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Low-key skip-with-confirm affordance (L0.md §9.2; CEO override: allow skip
 * with confirmation). A secondary text link reveals an inline confirmation —
 * NOT a window.confirm dialog — before the learner can submit the skip. The
 * notice makes the trade-off explicit: prerequisites may surface later.
 */
export default function SkipControl({ goalpostId, intentId, action }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Box>
      {!open && (
        <Link
          component="button"
          type="button"
          variant="body2"
          color="text.secondary"
          underline="hover"
          onClick={() => setOpen(true)}
        >
          Skip this goalpost
        </Link>
      )}
      <Collapse in={open}>
        <form action={action}>
          <input type="hidden" name="j" value={intentId} />
          <input type="hidden" name="goalpostId" value={goalpostId} />
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              You can skip this, but you may be assessed on its prerequisites
              later.
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <SubmitButton
                variant="outlined"
                size="medium"
                color="inherit"
                pendingLabel="Skipping…"
              >
                Skip anyway
              </SubmitButton>
              <Link
                component="button"
                type="button"
                variant="body2"
                color="text.secondary"
                underline="hover"
                onClick={() => setOpen(false)}
              >
                Never mind
              </Link>
            </Stack>
          </Stack>
        </form>
      </Collapse>
    </Box>
  );
}
