// Placeholder design tokens; to be filled in during the art nouveau / Gaudi-inspired design pass.

export interface ColorTokens {
  // Populated later: primary, secondary, surface, ink, accent ramps, etc.
}

export interface TypographyTokens {
  // Populated later: display, heading, body, mono families and scale.
}

export interface SpacingTokens {
  // Populated later: base unit and named steps.
}

export interface RadiiTokens {
  // Populated later: corner radius scale and organic curves.
}

export interface DesignTokens {
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radii: RadiiTokens;
}

export const tokens: Partial<DesignTokens> = {};
