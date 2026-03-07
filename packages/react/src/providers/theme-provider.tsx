/**
 * ThemeProvider — Applies Wingman theme via CSS custom properties.
 *
 * Wraps children in a `.wingman-root` container that carries the
 * `data-wingman-theme` attribute for light/dark/system mode and
 * injects any color overrides as inline CSS custom properties.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
  type CSSProperties,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WingmanTheme = 'light' | 'dark' | 'system';

export interface WingmanThemeColors {
  /** Primary accent (buttons, links, highlights). */
  primary?: string;
  /** Primary accent hover state. */
  primaryHover?: string;
  /** Primary accent subtle (focus rings, badges). */
  primarySubtle?: string;
  /** Main background. */
  bg?: string;
  /** Secondary background (cards, sidebars). */
  bgSecondary?: string;
  /** Tertiary background (code blocks, inputs). */
  bgTertiary?: string;
  /** Hover background. */
  bgHover?: string;
  /** Primary text. */
  text?: string;
  /** Secondary text. */
  textSecondary?: string;
  /** Tertiary text (placeholders). */
  textTertiary?: string;
  /** Inverse text (on primary-colored surfaces). */
  textInverse?: string;
  /** Border. */
  border?: string;
  /** Subtle border. */
  borderSubtle?: string;
  /** Success color. */
  success?: string;
  /** Error color. */
  error?: string;
  /** Warning color. */
  warning?: string;
  /** User message background. */
  userBg?: string;
  /** User message text. */
  userText?: string;
  /** Assistant message background. */
  assistantBg?: string;
  /** Assistant message text. */
  assistantText?: string;
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Color scheme: 'light', 'dark', or 'system' (OS preference). Default: 'system'. */
  theme?: WingmanTheme;
  /** Override any design token color. Mapped to --wm-* CSS custom properties. */
  colors?: WingmanThemeColors;
  /** Additional CSS class on the root container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ThemeContextValue {
  /** The resolved theme ('light' or 'dark' — never 'system'). */
  resolvedTheme: 'light' | 'dark';
  /** The raw theme prop value. */
  theme: WingmanTheme;
  /** Active color overrides. */
  colors: WingmanThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Access the current Wingman theme. Must be used inside <ThemeProvider>. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Color → CSS variable mapping
// ---------------------------------------------------------------------------

const COLOR_MAP: Record<keyof WingmanThemeColors, string> = {
  primary: '--wm-primary',
  primaryHover: '--wm-primary-hover',
  primarySubtle: '--wm-primary-subtle',
  bg: '--wm-bg',
  bgSecondary: '--wm-bg-secondary',
  bgTertiary: '--wm-bg-tertiary',
  bgHover: '--wm-bg-hover',
  text: '--wm-text',
  textSecondary: '--wm-text-secondary',
  textTertiary: '--wm-text-tertiary',
  textInverse: '--wm-text-inverse',
  border: '--wm-border',
  borderSubtle: '--wm-border-subtle',
  success: '--wm-success',
  error: '--wm-error',
  warning: '--wm-warning',
  userBg: '--wm-user-bg',
  userText: '--wm-user-text',
  assistantBg: '--wm-assistant-bg',
  assistantText: '--wm-assistant-text',
};

function buildColorStyles(colors: WingmanThemeColors): CSSProperties {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    const cssVar = COLOR_MAP[key as keyof WingmanThemeColors];
    if (cssVar && value) {
      style[cssVar] = value;
    }
  }
  return style as CSSProperties;
}

// ---------------------------------------------------------------------------
// System preference detection
// ---------------------------------------------------------------------------

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useSystemPreference(): 'light' | 'dark' {
  const [pref, setPref] = useState<'light' | 'dark'>(getSystemPreference);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setPref(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return pref;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({
  children,
  theme = 'system',
  colors = {},
  className = '',
}: ThemeProviderProps) {
  const systemPref = useSystemPreference();
  const resolvedTheme = theme === 'system' ? systemPref : theme;

  const colorStyles = useMemo(() => buildColorStyles(colors), [colors]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({ resolvedTheme, theme, colors }),
    [resolvedTheme, theme, colors],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <div
        className={`wingman-root ${className}`.trim()}
        data-wingman-theme={theme === 'system' ? 'system' : resolvedTheme}
        style={colorStyles}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
