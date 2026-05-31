import { createTheme } from "@mui/material/styles";
import { colors, radii, shadows, typography as typeTokens } from "./tokens";

// KnowledgeCore MUI theme — the component-layer mirror of lib/theme/tokens.ts.
// Warm paper, ink, one deep teal. Fraunces speaks (display/headings/numbers),
// Hanken operates AND reads (body/labels/buttons/metadata).
//
// Semantic-color remap (decided): the chatty MUI status palette collapses onto
// ink + teal so the product reads as one calm voice, not a traffic-light UI.
//   - info     -> teal (informational accent)
//   - success  -> teal-deep (a quiet "done", not a green)
//   - warning  -> ink-2 (a neutral note, carried by copy not color)
//   - error    -> muted warm red (--error), reserved for genuine failures
//                 (mic permission/hardware, hard load failures) ONLY.
// There is no second decorative hue and no gradients.

// MUI's shadows array must have exactly 25 entries (elevation 0..24). We keep
// elevation 0 as "none", then map the low elevations to the soft directional
// hover shadow and the higher ones to the larger card shadow, so any raised
// surface reads as the warm paper glow rather than a hard drop shadow.
const warmShadows = Array.from({ length: 25 }, (_, i) => {
  if (i === 0) return "none";
  if (i <= 2) return shadows.sm;
  return shadows.card;
}) as unknown as import("@mui/material/styles").Shadows;

export const theme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: colors.bone,
      paper: colors.surface,
    },
    text: {
      primary: colors.ink,
      secondary: colors.ink2,
      disabled: colors.ink3,
    },
    primary: {
      main: colors.teal,
      dark: colors.tealDeep,
      light: colors.tealSoft,
      contrastText: colors.surface,
    },
    // The status palette, remapped onto ink + teal (see note above).
    info: {
      main: colors.teal,
      dark: colors.tealDeep,
      light: colors.tealSoft,
      contrastText: colors.surface,
    },
    success: {
      main: colors.tealDeep,
      light: colors.tealSoft,
      contrastText: colors.surface,
    },
    warning: {
      main: colors.ink2,
      light: colors.surface2,
      contrastText: colors.surface,
    },
    error: {
      main: colors.error,
      contrastText: colors.surface,
    },
    divider: colors.line,
  },

  shape: {
    borderRadius: radii.md, // 18 — small cards / general default
  },

  shadows: warmShadows,

  typography: {
    // Hanken operates AND reads — the default everywhere.
    fontFamily: typeTokens.fontBody,

    // Display / hero — Fraunces, lightest weight at big size reads refined.
    h1: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 400,
      fontSize: "clamp(38px, 5.3vw, 62px)",
      lineHeight: 1.04,
      letterSpacing: "-.02em",
      fontVariationSettings: typeTokens.softDisplay,
    },
    // Section heading.
    h2: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 500,
      fontSize: 25,
      letterSpacing: "-.01em",
      fontVariationSettings: typeTokens.softUi,
    },
    // Card title (larger serif).
    h3: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 400,
      fontSize: 33,
      lineHeight: 1.08,
      letterSpacing: "-.01em",
      fontVariationSettings: typeTokens.softDisplay,
    },
    h4: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 500,
      letterSpacing: "-.01em",
      fontVariationSettings: typeTokens.softUi,
    },
    h5: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 500,
      letterSpacing: "-.01em",
      fontVariationSettings: typeTokens.softUi,
    },
    // List / row title.
    h6: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 500,
      fontSize: 20,
      letterSpacing: "-.01em",
      fontVariationSettings: typeTokens.softUi,
    },
    subtitle1: {
      fontFamily: typeTokens.fontDisplay,
      fontWeight: 500,
      letterSpacing: "-.01em",
      fontVariationSettings: typeTokens.softUi,
    },
    // Body + meta — Hanken, gets out of the way.
    body1: {
      fontFamily: typeTokens.fontBody,
      fontSize: 16,
      lineHeight: 1.55,
    },
    body2: {
      fontFamily: typeTokens.fontBody,
      fontSize: 14,
      lineHeight: 1.55,
    },
    button: {
      fontFamily: typeTokens.fontBody,
      fontWeight: 600,
      textTransform: "none",
      letterSpacing: 0,
    },
    caption: {
      fontFamily: typeTokens.fontBody,
      fontSize: 13,
    },
    // Eyebrow — uppercase, wide tracking.
    overline: {
      fontFamily: typeTokens.fontBody,
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: ".2em",
      textTransform: "uppercase",
    },
  },
});

export default theme;
