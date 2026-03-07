/**
 * Tests for ThemeProvider — CSS custom property injection,
 * dark/light/system mode, and color overrides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, type WingmanThemeColors } from '../providers/theme-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTheme(props: Partial<React.ComponentProps<typeof ThemeProvider>> = {}) {
  const html = renderToStaticMarkup(
    <ThemeProvider {...props}>
      <span data-testid="child">hello</span>
    </ThemeProvider>,
  );
  return html;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeProvider', () => {
  describe('data-wingman-theme attribute', () => {
    it('defaults to "system"', () => {
      const html = renderTheme();
      expect(html).toContain('data-wingman-theme="system"');
    });

    it('sets "light" when theme="light"', () => {
      const html = renderTheme({ theme: 'light' });
      expect(html).toContain('data-wingman-theme="light"');
    });

    it('sets "dark" when theme="dark"', () => {
      const html = renderTheme({ theme: 'dark' });
      expect(html).toContain('data-wingman-theme="dark"');
    });
  });

  describe('root container', () => {
    it('renders .wingman-root class', () => {
      const html = renderTheme();
      expect(html).toContain('class="wingman-root"');
    });

    it('appends custom className', () => {
      const html = renderTheme({ className: 'my-app' });
      expect(html).toContain('class="wingman-root my-app"');
    });

    it('renders children', () => {
      const html = renderTheme();
      expect(html).toContain('data-testid="child"');
      expect(html).toContain('hello');
    });
  });

  describe('color overrides', () => {
    it('injects --wm-primary for primary color', () => {
      const html = renderTheme({ colors: { primary: 'oklch(0.7 0.2 300)' } });
      expect(html).toContain('--wm-primary:oklch(0.7 0.2 300)');
    });

    it('injects multiple color overrides', () => {
      const colors: WingmanThemeColors = {
        primary: '#ff0000',
        bg: '#000000',
        text: '#ffffff',
      };
      const html = renderTheme({ colors });
      expect(html).toContain('--wm-primary:#ff0000');
      expect(html).toContain('--wm-bg:#000000');
      expect(html).toContain('--wm-text:#ffffff');
    });

    it('does not inject undefined color values', () => {
      const html = renderTheme({ colors: { primary: 'red' } });
      expect(html).not.toContain('--wm-bg-secondary');
      expect(html).not.toContain('--wm-error');
    });

    it('maps camelCase color keys to CSS variables', () => {
      const colors: WingmanThemeColors = {
        primaryHover: 'blue',
        bgSecondary: 'gray',
        textInverse: 'white',
        userBg: 'navy',
        assistantText: 'silver',
      };
      const html = renderTheme({ colors });
      expect(html).toContain('--wm-primary-hover:blue');
      expect(html).toContain('--wm-bg-secondary:gray');
      expect(html).toContain('--wm-text-inverse:white');
      expect(html).toContain('--wm-user-bg:navy');
      expect(html).toContain('--wm-assistant-text:silver');
    });

    it('renders no inline styles when no colors provided', () => {
      const html = renderTheme();
      // Should not have a style attribute with custom properties
      expect(html).not.toContain('--wm-');
    });
  });
});

describe('CSS file', () => {
  it('exists and contains design tokens', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const cssPath = path.resolve(
      import.meta.dirname,
      '../styles/wingman.css',
    );
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Light theme tokens
    expect(css).toContain('--wm-bg:');
    expect(css).toContain('--wm-primary:');
    expect(css).toContain('--wm-text:');

    // Dark theme
    expect(css).toContain("[data-wingman-theme='dark']");

    // System preference media query
    expect(css).toContain('prefers-color-scheme: dark');

    // Root container
    expect(css).toContain('.wingman-root');

    // Components
    expect(css).toContain('.wingman-welcome');
    expect(css).toContain('.wingman-chat-input');
    expect(css).toContain('.wingman-message');
    expect(css).toContain('.wingman-tool-status');
    expect(css).toContain('.wingman-thinking');
    expect(css).toContain('.wingman-markdown');

    // Animations
    expect(css).toContain('@keyframes wm-spin');
    expect(css).toContain('@keyframes wm-fade-in');

    // oklch color space
    expect(css).toContain('oklch');
  });
});
