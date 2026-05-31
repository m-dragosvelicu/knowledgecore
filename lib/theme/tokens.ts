// KnowledgeCore design tokens — the single typed source of truth, ported from
// design-system/colors_and_type.css. Warm paper, ink, one deep teal. No other
// hues, no gradients-as-decoration.
//
// THE RULE: Fraunces speaks, Hanken operates.
//   - Display/serif (Fraunces): wordmark, hero, headings, titles, numbers,
//     expressive italic lines. The SOFT axis softens terminals.
//   - Body/sans (Hanken Grotesk): body, inputs, labels, buttons, metadata,
//     eyebrows AND the long-form reading font (decided: no reading serif).
// Architects Daughter is annotation/presentation only and is intentionally NOT
// shipped in the app bundle; --font-annotate is documented but referenced nowhere
// in product code.

export interface ColorTokens {
  // Neutrals (warm, paper-like)
  bone: string; // page background
  surface: string; // cards, inputs, raised
  surface2: string; // recessed / side panels (also the Experience surface)
  // Ink (text) scale — warm three-step black
  ink: string; // primary text + dark fills
  ink2: string; // secondary / body copy
  ink3: string; // muted / meta / hints
  // Teal (the only chromatic color)
  teal: string; // accent, links, primary action
  tealDeep: string; // hover / pressed, eyebrows
  tealSoft: string; // tints, focus ring, fills
  // Lines & structure
  line: string; // borders, dividers, dot grid
  silhouette: string; // idle hand-drawn stroke
  // The one functional non-teal hue: a muted warm red, reserved for genuine
  // failures (mic errors, hard failures). Not a decorative color.
  error: string;
}

export interface TypographyTokens {
  fontDisplay: string; // Fraunces — speaks
  fontBody: string; // Hanken Grotesk — operates AND reads
  fontRead: string; // long-form reading (decided: stays Hanken)
  fontAnnotate: string; // Architects Daughter — docs only, never shipped
  // Variable-font axis settings for Fraunces.
  softDisplay: string; // big headlines: SOFT 20, opsz 144
  softUi: string; // smaller serif UI: SOFT 30
}

export interface SpacingTokens {
  // 8px base, generous (matches --sp-1..7).
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  s6: string;
  s7: string;
}

export interface RadiiTokens {
  sm: number; // icon buttons, chips
  md: number; // small cards
  lg: number; // feature cards, panels
  pill: number; // buttons, inputs, tags
}

export interface ShadowTokens {
  card: string; // feature cards, raised
  sm: string; // buttons, inputs, hover lift
  focusRing: string; // focus state
}

export interface DesignTokens {
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radii: RadiiTokens;
  shadows: ShadowTokens;
}

export const colors: ColorTokens = {
  bone: "#ECEAE4",
  surface: "#F8F6F1",
  surface2: "#F2EFE8",
  ink: "#33322D",
  ink2: "#5C5B54",
  ink3: "#8C8B82",
  teal: "#1F6E67",
  tealDeep: "#14534D",
  tealSoft: "#D6E4E1",
  line: "#D8D6CC",
  silhouette: "#C7C5BB",
  // Warm muted red — desaturated to sit on bone without clashing with the teal.
  error: "#9E4A3E",
};

export const typography: TypographyTokens = {
  // The CSS-variable handles below are filled in at runtime by next/font; the
  // string fallbacks keep these usable in plain CSS / SSR before hydration.
  fontDisplay: 'var(--font-fraunces), Fraunces, Georgia, serif',
  fontBody: 'var(--font-hanken), "Hanken Grotesk", -apple-system, system-ui, sans-serif',
  fontRead: 'var(--font-hanken), "Hanken Grotesk", -apple-system, system-ui, sans-serif',
  fontAnnotate: '"Architects Daughter", cursive',
  softDisplay: '"SOFT" 20, "opsz" 144',
  softUi: '"SOFT" 30',
};

export const spacing: SpacingTokens = {
  s1: "4px",
  s2: "8px",
  s3: "14px",
  s4: "22px",
  s5: "36px",
  s6: "58px",
  s7: "66px",
};

export const radii: RadiiTokens = {
  sm: 13,
  md: 18,
  lg: 28,
  pill: 999,
};

export const shadows: ShadowTokens = {
  card: "18px 22px 50px -30px rgba(45,44,40,.5)",
  sm: "10px 14px 30px -26px rgba(45,44,40,.5)",
  focusRing: "0 0 0 4px #D6E4E1",
};

export const tokens: DesignTokens = {
  colors,
  typography,
  spacing,
  radii,
  shadows,
};

export default tokens;
