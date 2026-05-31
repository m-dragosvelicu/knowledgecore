"use client";

// KnowledgeCore — pill inputs (Slice 1).
//
// Two pieces:
//   - PillTextField: a thin wrapper over MUI TextField. Single-line fields get
//     the full pill radius; multiline gets the 18px radius. The teal focus ring
//     (0 0 0 4px var(--teal-soft) + teal border) comes from the themed
//     MuiOutlinedInput override, so a bare <TextField> already focuses correctly;
//     this wrapper just enforces the pill shape and forwards everything.
//   - SearchPill: the bespoke hero search bar — a pill-shaped surface holding an
//     editable input plus an inline solid Begin button. Mirrors the kit's .start
//     field (preview/comp-input.html): surface fill, hairline border, focus adds
//     the teal-soft ring + teal border to the whole bar.

import { useState } from "react";
import type { FormEvent } from "react";
import TextField from "@mui/material/TextField";
import type { TextFieldProps } from "@mui/material/TextField";
import InputBase from "@mui/material/InputBase";
import Box from "@mui/material/Box";
import SolidButton from "./SolidButton";

/* ---------------------------------------------------------------------------
 * PillTextField — the general single-/multi-line themed field.
 * ------------------------------------------------------------------------- */
export function PillTextField(props: TextFieldProps) {
  return <TextField {...props} />;
}

/* ---------------------------------------------------------------------------
 * SearchPill — input + inline Begin button, the hero "start" field.
 * ------------------------------------------------------------------------- */
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
      <SolidButton type="submit" tone={tone} disabled={disabled} arrow={false}>
        {cta}
      </SolidButton>
    </Box>
  );
}
