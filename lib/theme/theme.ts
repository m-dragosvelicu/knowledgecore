import { createTheme } from "@mui/material/styles";
import { colors, radii, shadows, typography as typeTokens } from "./tokens";

// --- Module augmentation for the bespoke design-system extensions ----------
// A dedicated ink-filled button color (the default solid/commit tone), and a
// quiet uppercase `kcLabel` typography variant for recessed-panel labels.
declare module "@mui/material/styles" {
  interface Palette {
    kcInk: Palette["primary"];
  }
  interface PaletteOptions {
    kcInk?: PaletteOptions["primary"];
  }
  interface TypographyVariants {
    kcLabel: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    kcLabel?: React.CSSProperties;
  }
}
declare module "@mui/material/Button" {
  interface ButtonPropsColorOverrides {
    kcInk: true;
  }
}
declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    kcLabel: true;
  }
}

// KnowledgeCore MUI theme — component-layer mirror of lib/theme/tokens.ts.
// Semantic-color remap: the MUI status palette collapses onto ink + teal.
//   - info     -> teal (informational accent)
//   - success  -> teal-deep (a quiet "done", not a green)
//   - warning  -> ink-2 (a neutral note, carried by copy not color)
//   - error    -> muted warm red (--error), genuine failures only
//                 (mic permission/hardware, hard load failures)

// MUI's shadows array must have exactly 25 entries (elevation 0..24).
// Elevation 0 is "none"; low elevations map to the soft hover shadow, higher
// ones to the card shadow.
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
    // The default solid/commit button tone — an ink-filled pill with a warm
    // surface label. (color="primary" gives the warmer teal commit tone.)
    kcInk: {
      main: colors.ink,
      dark: colors.ink,
      light: colors.ink2,
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
    // Eyebrow — uppercase, wide tracking, teal-deep (see MuiTypography override
    // for the color, kept there so the variant alone stays color-neutral).
    overline: {
      fontFamily: typeTokens.fontBody,
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: ".2em",
      textTransform: "uppercase",
      lineHeight: 1.4,
    },
    // Quiet section label — gentler .06em tracking, muted ink.
    kcLabel: {
      fontFamily: typeTokens.fontBody,
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: colors.ink3,
      lineHeight: 1.4,
    },
  },

  components: {
    // ----- Solid (commit) button: clean filled pill, lift + soft shadow on
    //       hover, the trailing arrow sliding translateX(3px). No hand marks.
    MuiButton: {
      defaultProps: {
        disableElevation: true,
        disableRipple: true,
      },
      styleOverrides: {
        root: {
          borderRadius: radii.pill,
          textTransform: "none",
          fontWeight: 600,
          letterSpacing: 0,
          paddingInline: 22,
        },
        contained: {
          boxShadow: shadows.sm,
          transition:
            "transform .25s, box-shadow .25s, background-color .25s",
          "&:hover": {
            transform: "translateY(-1px)",
            boxShadow: shadows.sm,
          },
          // The arrow (wrapped in .kc-go-arrow) slides right on hover.
          "& .kc-go-arrow": {
            display: "inline-flex",
            transition: "transform .25s",
          },
          "&:hover .kc-go-arrow": {
            transform: "translateX(3px)",
          },
        },
        // Workbench/skip-tier MUI text/outlined buttons stay quiet (the true
        // hand-drawn wobble/skip live as their own components).
        text: {
          color: colors.ink2,
          "&:hover": {
            backgroundColor: "transparent",
            color: colors.tealDeep,
          },
        },
        outlined: {
          borderColor: colors.line,
          color: colors.ink2,
          "&:hover": {
            borderColor: colors.teal,
            backgroundColor: "transparent",
            color: colors.tealDeep,
          },
        },
      },
    },

    // ----- Cards + paper: surface fill, hairline border, soft shadow.
    //       Radius 18 by default (small); features opt into 28 via sx.
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: colors.surface,
          border: `1px solid ${colors.line}`,
          borderRadius: radii.md,
          boxShadow: shadows.card,
          backgroundImage: "none",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        outlined: {
          borderColor: colors.line,
        },
      },
    },

    // ----- Inputs: pill on single-line, 18px on multiline; teal focus ring.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: colors.surface,
          borderRadius: radii.pill,
          transition: "box-shadow .2s",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: colors.line,
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: colors.silhouette,
          },
          "&.Mui-focused": {
            boxShadow: shadows.focusRing,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: colors.teal,
              borderWidth: 1,
            },
          },
          // Multiline fields can't be pills — use the small-card radius.
          "&.MuiInputBase-multiline": {
            borderRadius: radii.md,
          },
        },
        input: {
          fontFamily: typeTokens.fontBody,
        },
      },
    },

    // ----- Chips: only teal-soft (fill) + ghost (outline) tones. No colored
    //       info/warning/success chips.
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: radii.pill,
          fontFamily: typeTokens.fontBody,
          fontWeight: 500,
          backgroundColor: colors.tealSoft,
          color: colors.tealDeep,
          border: "1px solid transparent",
        },
        outlined: {
          backgroundColor: "transparent",
          borderColor: colors.line,
          color: colors.ink3,
        },
      },
    },

    // ----- Typography: eyebrow color + quiet label come from the variants;
    //       give the overline its teal-deep color here.
    MuiTypography: {
      styleOverrides: {
        overline: {
          color: colors.tealDeep,
          display: "block",
        },
      },
      defaultProps: {
        variantMapping: {
          kcLabel: "div",
        },
      },
    },
  },
});

export default theme;
