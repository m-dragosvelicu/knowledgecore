// KnowledgeCore — small type components (Slice 1).
//
// The eyebrow (uppercase, wide .2em tracking, teal-deep), the quieter section
// label (gentler .06em tracking, muted ink), and the self-drawing headline
// underline wrapper. Eyebrow + SectionLabel render through MUI Typography so
// they inherit the themed overline/quiet-label styling (see theme.ts
// MuiTypography overrides). HeadlineUnderline is a plain wrapper that drops the
// HandUnderline mark under whatever inline headline you pass as children.

import type { ReactNode } from "react";
import Typography from "@mui/material/Typography";
import type { TypographyProps } from "@mui/material/Typography";
import { HandUnderline } from "@/components/marks/Marks";

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

/* ---------------------------------------------------------------------------
 * HeadlineUnderline — wraps an inline headline and draws the signature wobbly
 * underline beneath it. Use around a span/heading whose width should define the
 * underline. The headline keeps normal flow; the mark is absolutely positioned.
 *
 *   <HeadlineUnderline>
 *     <Typography variant="h3" component="span">The ideas behind Art Nouveau</Typography>
 *   </HeadlineUnderline>
 *
 * Sizing: the wrapper shrink-wraps to the rendered TEXT width via
 * `width: fit-content` (with `maxWidth: 100%` so it still wraps inside narrow
 * columns). `fit-content` is what keeps the underline hugging the text even when
 * the wrapper lands as a flex item (e.g. inside a MUI <Stack>, whose default
 * `align-items: stretch` would otherwise blow a plain inline-block out to the
 * full column width) or when its child is a block-level heading (an <h1>/<h3>
 * that would fill an inline-block). The HandUnderline SVG is width:100% of this
 * wrapper, so it inherits the text width and scales its path to match; the
 * draw-on animation lives on the path (pathLength + stroke-dashoffset) and is
 * unaffected by the width. On a two-line heading the wrapper hugs the wider
 * line's text block and the underline sits under the last line.
 * ------------------------------------------------------------------------- */
export function HeadlineUnderline({
  children,
  play = true,
  strokeWidth = 2.4,
  delay,
}: {
  children: ReactNode;
  play?: boolean;
  strokeWidth?: number;
  delay?: string;
}) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: "fit-content",
        maxWidth: "100%",
        margin: "0 0 2px",
      }}
    >
      {children}
      <HandUnderline play={play} strokeWidth={strokeWidth} delay={delay} />
    </span>
  );
}
