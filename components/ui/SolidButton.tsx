"use client";

// Commit tier: pill shape, lift, shadow and arrow-slide come from the theme's
// MuiButton `contained` override (lib/theme/theme.ts) — a plain
// <Button variant="contained"> already looks right; this wrapper only adds the
// optional trailing Arrow (endIcon).
// tone="teal" maps to MUI color="primary"; default "ink" uses the theme's
// `kcInk` color.
// `pending` is an explicit prop (not useFormStatus): every call site drives its
// own onSubmit/onClick rather than <form action>.

import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import type { ButtonProps } from "@mui/material/Button";
import type { ReactNode } from "react";
import { Arrow } from "@/components/marks/Marks";

export type SolidButtonProps = Omit<ButtonProps, "variant" | "color"> & {
  children: ReactNode;
  /** Visual tone of the filled pill. "ink" (default) or warmer "teal". */
  tone?: "ink" | "teal";
  /** Show the trailing arrow that slides right on hover. Default true. */
  arrow?: boolean;
  /** When true, shows a spinner + pendingLabel and disables the button. */
  pending?: boolean;
  /** Label shown while pending. Defaults to the button's own children. */
  pendingLabel?: ReactNode;
};

export default function SolidButton({
  children,
  tone = "ink",
  arrow = true,
  pending = false,
  pendingLabel,
  endIcon,
  disabled,
  ...rest
}: SolidButtonProps) {
  return (
    <Button
      {...rest}
      variant="contained"
      color={tone === "teal" ? "primary" : "kcInk"}
      disabled={disabled || pending}
      startIcon={
        pending ? (
          <CircularProgress size={18} color="inherit" thickness={5} />
        ) : undefined
      }
      // The arrow sits in a span the override targets to slide on hover.
      // Suppressed while pending: the spinner already carries the busy cue.
      endIcon={
        pending
          ? undefined
          : (endIcon ??
            (arrow ? (
              <span className="kc-go-arrow" aria-hidden="true">
                <Arrow size={15} />
              </span>
            ) : undefined))
      }
    >
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
