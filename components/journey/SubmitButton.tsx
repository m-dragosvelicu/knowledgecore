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
 * Guards against spam-clicking slow server actions (bugs/no-feedback-on-submit):
 * disables itself, shows a spinner, swaps label, the instant it's pressed.
 * Inside a <form action>: leave `pending` undefined (reads useFormStatus).
 * Otherwise pass `pending` explicitly (e.g. useTransition).
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
