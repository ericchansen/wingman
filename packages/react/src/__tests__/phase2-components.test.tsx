/**
 * Tests for Phase 2 React components — TokenUsage, ModelPicker,
 * ModeSwitcher, and DebugPanel.
 *
 * Uses renderToStaticMarkup (SSR) for lightweight output testing.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenUsage } from '../components/token-usage.js';
import { ModeSwitcher } from '../components/mode-switcher.js';
import { ModelPicker } from '../components/model-picker.js';
import { DebugPanel, type DebugEvent } from '../components/debug-panel.js';

// ---------------------------------------------------------------------------
// TokenUsage
// ---------------------------------------------------------------------------

describe('TokenUsage', () => {
  it('renders nothing when usage is null', () => {
    const html = renderToStaticMarkup(<TokenUsage usage={null} />);
    expect(html).toBe('');
  });

  it('renders input and output token counts', () => {
    const html = renderToStaticMarkup(
      <TokenUsage usage={{ inputTokens: 1500, outputTokens: 300 }} />,
    );
    expect(html).toContain('1.5K');
    expect(html).toContain('300');
    expect(html).toContain('wingman-token-usage');
  });

  it('renders cache tokens when present', () => {
    const html = renderToStaticMarkup(
      <TokenUsage usage={{ inputTokens: 100, outputTokens: 50, cacheReadTokens: 2000 }} />,
    );
    expect(html).toContain('2.0K');
    expect(html).toContain('⚡');
  });

  it('omits cache tokens when zero', () => {
    const html = renderToStaticMarkup(
      <TokenUsage usage={{ inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 }} />,
    );
    expect(html).not.toContain('⚡');
  });

  it('formats millions correctly', () => {
    const html = renderToStaticMarkup(
      <TokenUsage usage={{ inputTokens: 1_500_000, outputTokens: 50 }} />,
    );
    expect(html).toContain('1.5M');
  });

  it('applies custom className', () => {
    const html = renderToStaticMarkup(
      <TokenUsage usage={{ inputTokens: 1, outputTokens: 1 }} className="custom" />,
    );
    expect(html).toContain('custom');
  });
});

// ---------------------------------------------------------------------------
// ModeSwitcher
// ---------------------------------------------------------------------------

describe('ModeSwitcher', () => {
  it('renders three mode options', () => {
    const html = renderToStaticMarkup(
      <ModeSwitcher currentMode="interactive" sessionId="s1" />,
    );
    expect(html).toContain('Interactive');
    expect(html).toContain('Plan');
    expect(html).toContain('Autopilot');
  });

  it('marks the current mode as active', () => {
    const html = renderToStaticMarkup(
      <ModeSwitcher currentMode="plan" sessionId="s1" />,
    );
    // The "plan" radio should be checked
    expect(html).toContain('checked');
  });

  it('uses native radio inputs', () => {
    const html = renderToStaticMarkup(
      <ModeSwitcher currentMode="interactive" sessionId="s1" />,
    );
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="wingman-mode"');
  });

  it('disables inputs when no session', () => {
    const html = renderToStaticMarkup(
      <ModeSwitcher currentMode="interactive" sessionId={null} />,
    );
    expect(html).toContain('disabled');
  });

  it('renders as a fieldset with legend', () => {
    const html = renderToStaticMarkup(
      <ModeSwitcher currentMode="interactive" sessionId="s1" />,
    );
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
  });
});

// ---------------------------------------------------------------------------
// ModelPicker
// ---------------------------------------------------------------------------

describe('ModelPicker', () => {
  it('renders nothing when no models loaded (initial state)', () => {
    // ModelPicker fetches models via useEffect — SSR won't run effects
    const html = renderToStaticMarkup(
      <ModelPicker currentModel="claude-sonnet-4" sessionId="s1" />,
    );
    // No models fetched in SSR, so should render nothing
    expect(html).toBe('');
  });
});

// ---------------------------------------------------------------------------
// DebugPanel
// ---------------------------------------------------------------------------

describe('DebugPanel', () => {
  const sampleEvents: DebugEvent[] = [
    { timestamp: 1000, event: 'delta', data: { content: 'hello' } },
    { timestamp: 2000, event: 'tool_start', data: { toolName: 'search' } },
    { timestamp: 3000, event: 'done', data: { sessionId: 's1' } },
  ];

  it('renders toggle button with event count', () => {
    const html = renderToStaticMarkup(<DebugPanel events={sampleEvents} />);
    expect(html).toContain('3 events');
    expect(html).toContain('🐛');
  });

  it('starts collapsed (no event list in SSR)', () => {
    const html = renderToStaticMarkup(<DebugPanel events={sampleEvents} />);
    // Panel starts closed — content div should not be present
    expect(html).not.toContain('wingman-debug-panel-content');
  });

  it('renders with empty events array', () => {
    const html = renderToStaticMarkup(<DebugPanel events={[]} />);
    expect(html).toContain('0 events');
  });

  it('applies custom className', () => {
    const html = renderToStaticMarkup(<DebugPanel events={[]} className="my-debug" />);
    expect(html).toContain('my-debug');
  });
});
