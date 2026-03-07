/**
 * ThinkingBlock — Collapsible reasoning/thinking content.
 */

import React, { useState } from 'react';

export interface ThinkingBlockProps {
  content: string;
  defaultOpen?: boolean;
  className?: string;
}

export function ThinkingBlock({
  content,
  defaultOpen = false,
  className = '',
}: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!content) return null;

  return (
    <div className={`wingman-thinking ${className}`}>
      <button
        className="wingman-thinking-toggle"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="wingman-thinking-icon">
          {isOpen ? '▾' : '▸'}
        </span>
        <span className="wingman-thinking-label">Thinking</span>
      </button>
      {isOpen && (
        <div className="wingman-thinking-content">
          <pre>{content}</pre>
        </div>
      )}
    </div>
  );
}
