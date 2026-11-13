// ---------------------------------------------------------------------------
// Design tokens — the seed/source colors, typography, spacing, radius, shadow.
// (plan/07 P1 1.4 "Basic design system"; plan/10 `design_systems` table)
// The web app maps these into CSS custom properties; the AI uses them as a
// baseline palette when generating a document without an explicit theme.
// ---------------------------------------------------------------------------

export interface ColorTokens {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  ring: string;
  success: string;
  warning: string;
  danger: string;
}

export interface TypographyTokens {
  fontFamily: string;
  fontFamilyMono: string;
  fontSizeXs: number;
  fontSizeSm: number;
  fontSizeBase: number;
  fontSizeLg: number;
  fontSizeXl: number;
  fontSize2xl: number;
  fontSize3xl: number;
  fontWeightNormal: number;
  fontWeightMedium: number;
  fontWeightBold: number;
  lineHeightTight: number;
  lineHeightNormal: number;
}

export interface SpacingTokens {
  /** scale index = size in px (used creatively: spacing[i]) */
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  s6: number;
  s8: number;
  s10: number;
  s12: number;
  s16: number;
  s20: number;
  s24: number;
  s32: number;
  s40: number;
  s48: number;
  s64: number;
  s96: number;
  s128: number;
  s192: number;
  s256: number;
}

export interface RadiusTokens {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
}

export interface DesignTokens {
  name: string;
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  shadows: ShadowTokens;
  breakpoints: { sm: number; md: number; lg: number; xl: number };
}

/** Default "Neutral" theme — matches the default Theme in ui-schema. */
export const defaultTokens: DesignTokens = {
  name: "neutral",
  colors: {
    primary: "#2563EB",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#0F172A",
    muted: "#F1F5F9",
    mutedForeground: "#64748B",
    border: "#E2E8F0",
    ring: "#3B82F6",
    success: "#16A34A",
    warning: "#F59E0B",
    danger: "#DC2626",
  },
  typography: {
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontFamilyMono: "ui-monospace, SFMono-Regular, monospace",
    fontSizeXs: 12,
    fontSizeSm: 14,
    fontSizeBase: 16,
    fontSizeLg: 18,
    fontSizeXl: 20,
    fontSize2xl: 24,
    fontSize3xl: 30,
    fontWeightNormal: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
    lineHeightTight: 1.25,
    lineHeightNormal: 1.5,
  },
  spacing: {
    s0: 0, s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32,
    s10: 40, s12: 48, s16: 64, s20: 80, s24: 96, s32: 128, s40: 160,
    s48: 192, s64: 256, s96: 384, s128: 512, s192: 768, s256: 1024,
  },
  radius: { sm: 4, md: 6, lg: 8, xl: 12, full: 9999 },
  shadows: {
    sm: "0 1px 2px rgba(15,23,42,0.06)",
    md: "0 4px 6px -1px rgba(15,23,42,0.1), 0 2px 4px -2px rgba(15,23,42,0.05)",
    lg: "0 10px 15px -3px rgba(15,23,42,0.1), 0 4px 6px -4px rgba(15,23,42,0.05)",
  },
  breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 },
};

export function tokensToCssVars(tokens: DesignTokens): Record<string, string> {
  const c = tokens.colors;
  const t = tokens.typography;
  const r = tokens.radius;
  return {
    "--ds-primary": c.primary,
    "--ds-primary-foreground": c.primaryForeground,
    "--ds-background": c.background,
    "--ds-foreground": c.foreground,
    "--ds-muted": c.muted,
    "--ds-muted-foreground": c.mutedForeground,
    "--ds-border": c.border,
    "--ds-ring": c.ring,
    "--ds-success": c.success,
    "--ds-warning": c.warning,
    "--ds-danger": c.danger,
    "--ds-font-sans": t.fontFamily,
    "--ds-font-mono": t.fontFamilyMono,
    "--ds-radius-sm": `${r.sm}px`,
    "--ds-radius-md": `${r.md}px`,
    "--ds-radius-lg": `${r.lg}px`,
  };
}
