/**
 * ModelPicker — Dropdown for switching the active model.
 *
 * Fetches available models from /api/models and fires a POST
 * to /api/session/:id/model on selection.
 */

import React, { useEffect, useState } from 'react';

export interface ModelPickerProps {
  /** Currently active model ID. */
  currentModel: string | null;
  /** Current session ID (required to switch model). */
  sessionId: string | null;
  /** Base URL for the Wingman API. Default: '' (same origin). */
  apiUrl?: string;
  /** Called after a successful model switch. */
  onModelChange?: (model: string) => void;
  className?: string;
}

interface ModelOption {
  id: string;
  name: string;
}

export function ModelPicker({
  currentModel,
  sessionId,
  apiUrl = '',
  onModelChange,
  className = '',
}: ModelPickerProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/models`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.models)) {
          setModels(data.models);
        }
      })
      .catch(() => { /* silently fail — picker just stays empty */ });
    return () => { cancelled = true; };
  }, [apiUrl]);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    if (!sessionId || !model || model === currentModel) return;

    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/session/${sessionId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        onModelChange?.(model);
      }
    } catch {
      /* silently fail */
    } finally {
      setLoading(false);
    }
  };

  if (models.length === 0) return null;

  return (
    <div className={`wingman-model-picker ${className}`}>
      <select
        className="wingman-model-picker-select"
        value={currentModel ?? ''}
        onChange={handleChange}
        disabled={loading || !sessionId}
        aria-label="Select model"
      >
        {!currentModel && <option value="">Select model…</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
