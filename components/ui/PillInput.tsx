"use client";

// PillTextField: pill radius + teal focus ring come from the themed
// MuiOutlinedInput override (a bare TextField already focuses correctly); this
// wrapper only enforces the pill shape.
// SearchPill: the hero search bar, mirrors the kit's .start field
// (preview/comp-input.html).

import { useState } from "react";
import type { FormEvent } from "react";
import TextField from "@mui/material/TextField";
import type { TextFieldProps } from "@mui/material/TextField";
import InputBase from "@mui/material/InputBase";
import Box from "@mui/material/Box";
import SolidButton from "./SolidButton";

export function PillTextField(props: TextFieldProps) {
  return <TextField {...props} />;
}

export type SearchPillProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** CTA label on the inline solid button. Default "Begin". */
  cta?: string;
  /** Tone of the inline commit button. */
  tone?: "ink" | "teal";
  disabled?: boolean;
  /** Shows the commit button's spinner + pendingLabel (passed through to SolidButton). */
  pending?: boolean;
  /** Label shown on the commit button while pending; defaults to `cta`. */
  pendingLabel?: string;
};

export function SearchPill({
  value,
  defaultValue,
  onChange,
  onSubmit,
  placeholder,
  cta = "Begin",
  tone = "ink",
  disabled,
  pending,
  pendingLabel,
}: SearchPillProps) {
  const [focused, setFocused] = useState(false);
  // Support controlled and uncontrolled use.
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;

  const setValue = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.(current);
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        bgcolor: "background.paper",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-pill)",
        p: "9px 9px 9px 26px",
        boxShadow: "var(--shadow-sm)",
        transition: "box-shadow .2s, border-color .2s",
        ...(focused && {
          borderColor: "var(--teal)",
          boxShadow: "var(--focus-ring), var(--shadow-sm)",
        }),
      }}
    >
      <InputBase
        value={current}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        sx={{
          flex: 1,
          fontSize: 17,
          fontFamily: "var(--font-body)",
          color: "var(--ink)",
          "& input::placeholder": { color: "var(--ink-3)", opacity: 1 },
        }}
      />
      <SolidButton
        type="submit"
        tone={tone}
        disabled={disabled}
        arrow={false}
        pending={pending}
        pendingLabel={pendingLabel}
      >
        {cta}
      </SolidButton>
    </Box>
  );
}
