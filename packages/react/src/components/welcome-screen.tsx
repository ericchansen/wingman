/**
 * WelcomeScreen — Default empty-state greeting.
 */

import React from 'react';

export interface WelcomeScreenProps {
  title?: string;
  message?: string;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  className?: string;
}

export function WelcomeScreen({
  title = 'Wingman',
  message = 'How can I help?',
  suggestions = [],
  onSuggestionClick,
  className = '',
}: WelcomeScreenProps) {
  return (
    <div className={`wingman-welcome ${className}`}>
      <div className="wingman-welcome-icon">
        {/* Simple chat bubble icon */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1 className="wingman-welcome-title">{title}</h1>
      <p className="wingman-welcome-message">{message}</p>
      {suggestions.length > 0 && (
        <div className="wingman-welcome-suggestions">
          {suggestions.map((suggestion, i) => (
            <button
              key={i}
              type="button"
              className="wingman-welcome-suggestion"
              onClick={() => onSuggestionClick?.(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
