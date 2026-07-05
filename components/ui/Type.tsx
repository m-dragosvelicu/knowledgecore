// KnowledgeCore — small type components (Slice 1).
//
// The eyebrow (uppercase, wide .2em tracking, teal-deep) and the quieter
// section label (gentler .06em tracking, muted ink). Both render through MUI
// Typography so they inherit the themed overline/quiet-label styling (see
// theme.ts MuiTypography overrides).
//
// HeadlineUnderline (the self-drawing headline underline wrapper) lives in its
// own file (./HeadlineUnderline) because it needs a client-side layout
// measurement and so carries a "use client" boundary; Eyebrow/SectionLabel
// stay server-safe here.

import Typography from "@mui/material/Typography";
import type { TypographyProps } from "@mui/material/Typography";

/* ---------------------------------------------------------------------------
 * Eyebrow — the small uppercase teal-deep kicker above a heading.
 * e.g. "In progress · goalpost 3 of 5", "Read · about 4 min".
 * Renders as MUI's `overline` variant, which the theme styles as the eyebrow.
 * ------------------------------------------------------------------------- */
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

/* ---------------------------------------------------------------------------
 * SectionLabel — the quieter uppercase label (muted ink, gentler tracking).
 * e.g. the "to next checkpoint" caption on a recessed side panel.
 * Uses the bespoke `kc-label` typography variant added in the theme.
 * ------------------------------------------------------------------------- */
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
