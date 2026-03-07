/**
 * ModeSwitcher — Toggle between agent modes.
 *
 * Modes: interactive (default), plan, autopilot.
 */

import React, { useState } from 'react';

export interface ModeSwitcherProps {
  /** Currently active mode. */
  currentMode: string | null;
  /** Current session ID (required to switch mode). */
  sessionId: string | null;
  /** Base URL for the Wingman API. Default: '' (same origin). */
  apiUrl?: string;
  /** Called after a successful mode switch. */
  onModeChange?: (mode: string) => void;
  className?: string;
}

const MODES = [
  { id: 'interactive', label: 'Interactive', icon: '💬' },
  { id: 'plan', label: 'Plan', icon: '📋' },
  { id: 'autopilot', label: 'Autopilot', icon: '🤖' },
] as const;

export function ModeSwitcher({
  currentMode,
  sessionId,
  apiUrl = '',
  onModeChange,
  className = '',
}: ModeSwitcherProps) {
  const [loading, setLoading] = useState(false);

  const handleSwitch = async (mode: string) => {
    if (!sessionId || mode === currentMode || loading) return;

    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/session/${sessionId}/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        onModeChange?.(mode);
      }
    } catch {
      /* silently fail */
    } finally {
      setLoading(false);
    }
  };

  return (
    <fieldset className={`wingman-mode-switcher ${className}`} aria-label="Agent mode">
      <legend className="wingman-mode-switcher-legend">Mode</legend>
      {MODES.map((m) => (
        <label
          key={m.id}
          className={`wingman-mode-switcher-option ${currentMode === m.id ? 'wingman-mode-switcher-active' : ''}`}
        >
          <input
            type="radio"
            name="wingman-mode"
            value={m.id}
            checked={currentMode === m.id}
            onChange={() => handleSwitch(m.id)}
            disabled={loading || !sessionId}
            className="wingman-mode-switcher-radio"
          />
          <span className="wingman-mode-switcher-icon">{m.icon}</span>
          <span className="wingman-mode-switcher-label">{m.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
