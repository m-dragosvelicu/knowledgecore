"use client";

import { useId, useState } from "react";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import type { TextFieldProps } from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import MicButton from "@/components/journey/MicButton";

/**
 * Self-contained TextField + shared MicButton, for uncontrolled/server-form
 * call sites (submits by `name` inside a <form action>). Internally
 * controlled so dictation appends to the current text via the same editable
 * field (editable-field contract) before the form submits.
 */

type Props = Omit<TextFieldProps, "value" | "onChange"> & {
  /** Form field name (so the value submits with the surrounding <form>). */
  name: string;
  /** Initial value (e.g. a previously entered intent). */
  defaultValue?: string;
  /** Disable the mic only (the field stays editable). */
  micDisabled?: boolean;
  languageHint?: string;
  /**
   * Standalone label above the field instead of MUI's floating label — the
   * floating variant collided with the focus glow (bug: intent-label-collides-
   * with-focus-glow). Do not also pass the floating `label` prop when set.
   */
  aboveLabel?: string;
  /** Per-call-site Stack styling; opt-in so other call sites keep default. */
  containerSx?: SxProps<Theme>;
};

export default function MicTextField({
  name,
  defaultValue = "",
  micDisabled = false,
  languageHint,
  aboveLabel,
  containerSx,
  id,
  ...textFieldProps
}: Props) {
  const [value, setValue] = useState<string>(defaultValue);
  const generatedId = useId();
  const fieldId = id ?? `mic-field-${generatedId}`;

  function appendTranscript(text: string) {
    setValue((prev) => {
      const sep = prev.trim().length > 0 ? `${prev.replace(/\s+$/, "")} ` : "";
      return `${sep}${text}`;
    });
  }

  return (
    <Stack
      spacing={0.5}
      sx={[{ width: "100%" }, ...(Array.isArray(containerSx) ? containerSx : [containerSx])]}
    >
      {aboveLabel && (
        <Typography
          component="label"
          htmlFor={fieldId}
          sx={{
            mb: "8px",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.35,
            color: "var(--ink)",
          }}
        >
          {aboveLabel}
        </Typography>
      )}
      <TextField
        {...textFieldProps}
        id={fieldId}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Box sx={{ alignSelf: "flex-start" }}>
        <MicButton
          onTranscript={appendTranscript}
          disabled={micDisabled}
          languageHint={languageHint}
        />
      </Box>
    </Stack>
  );
}
