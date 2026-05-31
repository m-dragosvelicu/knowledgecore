"use client";

import { useState } from "react";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import type { TextFieldProps } from "@mui/material/TextField";
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
};

export default function MicTextField({
  name,
  defaultValue = "",
  micDisabled = false,
  languageHint,
  ...textFieldProps
}: Props) {
  const [value, setValue] = useState<string>(defaultValue);

  function appendTranscript(text: string) {
    setValue((prev) => {
      const sep = prev.trim().length > 0 ? `${prev.replace(/\s+$/, "")} ` : "";
      return `${sep}${text}`;
    });
  }

  return (
    <Stack spacing={0.5}>
      <TextField
        {...textFieldProps}
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
