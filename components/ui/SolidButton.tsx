"use client";

// KnowledgeCore — Solid (commit) button (Slice 1).
//
// The decisive, state-changing tier: Begin, Resume, Continue this goalpost,
// Lock it in. A clean filled pill (ink by default, teal for the warmer Resume
// tone), white label, a small lift (translateY(-1px) + soft shadow) on hover.
// NO hand marks — commitment reads as a calm solid surface, not a sketch.
//
// The pill shape, lift, shadow and arrow-slide live in the theme MuiButton
// `contained` override (lib/theme/theme.ts) so any plain
// <Button variant="contained"> already gets the solid look. This wrapper only
// adds the optional trailing Arrow that slides translateX(3px) on hover, which
// is the one bit that needs an endIcon. Use it for the canonical commit CTAs;
// reach for a bare MUI <Button variant="contained"> when no arrow is wanted.
//
// `tone="teal"` maps to MUI color="primary" (teal); the default ink tone uses a
// dedicated `kcInk` color injected in the theme palette.
//
// Pending affordance: callers that drive their own busy flag (useTransition,
// a manual async onClick) can pass `pending` to get the same 18px
// CircularProgress + label-swap SubmitButton uses for <form action> submits.
// Unlike SubmitButton this never reads useFormStatus — every existing
// SolidButton call site drives its own onSubmit/onClick (no <form action=...>
// in the codebase reaches a SolidButton), so an explicit prop is the honest
// contract and existing call sites are untouched when `pending` is omitted.

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
