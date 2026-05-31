"use client";

import { useFormStatus } from "react-dom";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import type { ButtonProps } from "@mui/material/Button";
import type { ReactNode } from "react";

type SubmitButtonProps = Omit<ButtonProps, "type"> & {
  /**
   * Label shown while the parent <form action={...}> submission is in flight.
   * Defaults to "Working...".
   */
  pendingLabel?: ReactNode;
  /**
   * When this button does not live inside a <form action>, the caller drives the
   * pending state explicitly (e.g. a useTransition isPending flag). Passing this
   * prop overrides the useFormStatus reading.
   */
  pending?: boolean;
  children: ReactNode;
};

/**
 * A submit button that gives immediate, unmistakable feedback the moment it is
 * pressed: it disables itself, swaps in a spinner, and changes its label. This
 * is the single guard against spam-clicking buttons that fire slow server
 * actions (the live evaluator, path generation, etc.) per
 * bugs/no-feedback-on-submit.
 *
 * Two modes:
 *  - Inside a native <form action={serverAction}>: leave `pending` undefined and
 *    the button reads useFormStatus() automatically.
 *  - For onClick / useTransition flows: pass `pending={isPending}` explicitly.
 */
export default function SubmitButton({
  pendingLabel = "Working…",
  pending,
  children,
  disabled,
  startIcon,
  ...rest
}: SubmitButtonProps) {
  const status = useFormStatus();
  // `pending` prop wins when provided (onClick / transition flows); otherwise
  // fall back to the enclosing form's submission status.
  const isPending = pending ?? status.pending;

  return (
    <Button
      {...rest}
      type="submit"
      disabled={disabled || isPending}
      startIcon={
        isPending ? (
          <CircularProgress size={18} color="inherit" thickness={5} />
        ) : (
          startIcon
        )
      }
    >
      {isPending ? pendingLabel : children}
    </Button>
  );
}
