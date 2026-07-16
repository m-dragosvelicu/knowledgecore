// Eyebrow/SectionLabel render through MUI Typography (themed overline /
// kcLabel variants in theme.ts) and stay server-safe.
// HeadlineUnderline lives in its own file because it needs a client-side
// layout measurement ("use client" boundary).

import Typography from "@mui/material/Typography";
import type { TypographyProps } from "@mui/material/Typography";

export function Eyebrow({
  children,
  component = "div",
  ...rest
}: TypographyProps & { component?: React.ElementType }) {
  return (
    <Typography variant="overline" component={component} {...rest}>
      {children}
    </Typography>
  );
}

export function SectionLabel({
  children,
  component = "div",
  ...rest
}: TypographyProps & { component?: React.ElementType }) {
  return (
    <Typography variant="kcLabel" component={component} {...rest}>
      {children}
    </Typography>
  );
}
