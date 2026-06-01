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
 * L1 Slice 3 — a self-contained MUI TextField with the shared MicButton attached,
 * for SERVER-FORM / uncontrolled call sites (the intent page, the contestability
 * override) where the field submits by `name` inside a <form action={...}> and the
 * parent is a server component that can't hold React state.
 *
 * It becomes a controlled field internally so the dictated transcript lands in the
 * SAME editable box the learner types in (the editable-field contract): the mic
 * APPENDS its transcript to the current text, and the learner can edit it before
 * the form submits. The `name` prop keeps the value in the submitted FormData.
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
   * Render a clean, standalone label ABOVE the field (its own line, with
   * breathing room) instead of MUI's notched/floating label. This keeps the
   * label out of the teal focus ring + rounded border, where the floating
   * variant collided with the glow and became hard to read (bugs: intent-label
   * collides-with-focus-glow). When set, do NOT also pass the floating `label`.
   */
  aboveLabel?: string;
  /**
   * Per-call-site styling for the wrapper Stack (e.g. a max-width so the intent
   * field reads as a generous centerpiece). Kept opt-in so other call sites
   * (the contestability override) are not restyled.
   */
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
