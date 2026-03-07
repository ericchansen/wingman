/**
 * ToolStatus — Inline tool execution status display.
 *
 * Shows a spinner while running → checkmark on completion.
 */

import React from 'react';
import type { ToolExecution } from '@wingman-chat/core';

export interface ToolStatusProps {
  tool: ToolExecution;
  className?: string;
}

/** Format a tool name for display (snake_case → Title Case). */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Calculate duration in seconds. */
function getDuration(tool: ToolExecution): string | null {
  if (!tool.completedAt) return null;
  const ms = tool.completedAt - tool.startedAt;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolStatus({ tool, className = '' }: ToolStatusProps) {
  const isRunning = tool.status === 'running';
  const duration = getDuration(tool);

  return (
    <div
      className={`wingman-tool-status wingman-tool-status-${tool.status} ${className}`}
      data-status={tool.status}
    >
      <span className="wingman-tool-status-icon">
        {isRunning ? (
          <span className="wingman-spinner" aria-label="Running">⟳</span>
        ) : tool.status === 'error' ? (
          <span aria-label="Error">✗</span>
        ) : (
          <span aria-label="Complete">✓</span>
        )}
      </span>
      <span className="wingman-tool-status-name">
        {formatToolName(tool.toolName)}
      </span>
      {tool.result && !isRunning && (
        <span className="wingman-tool-status-result">
          · {tool.result.slice(0, 100)}
        </span>
      )}
      {duration && (
        <span className="wingman-tool-status-duration">
          ({duration})
        </span>
      )}
    </div>
  );
}
