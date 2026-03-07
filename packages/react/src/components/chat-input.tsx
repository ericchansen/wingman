/**
 * ChatInput — Message input with send button and keyboard submit.
 */

import React, { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { useChat } from '../providers/chat-provider.js';

export interface ChatInputProps {
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  placeholder = 'Ask anything...',
  className = '',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, state } = useChat();

  const handleSubmit = useCallback(() => {
    if (!value.trim() || state.isStreaming) return;
    sendMessage(value.trim());
    setValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, sendMessage, state.isStreaming]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  return (
    <div className={`wingman-chat-input ${className}`}>
      <div className="wingman-chat-input-container">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder}
          rows={1}
          disabled={state.isStreaming}
          className="wingman-chat-input-textarea"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || state.isStreaming}
          className="wingman-chat-input-button"
          aria-label="Send message"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
