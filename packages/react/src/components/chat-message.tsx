/**
 * ChatMessage — Renders a single user or assistant message bubble.
 */

import React from 'react';
import type { ChatMessage as ChatMessageType } from 'wingman';
import { ToolStatus } from './tool-status.js';
import { ThinkingBlock } from './thinking-block.js';
import { MarkdownRenderer } from './markdown-renderer.js';

export interface ChatMessageProps {
  message: ChatMessageType;
  className?: string;
}

export function ChatMessage({ message, className = '' }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`wingman-message wingman-message-${message.role} ${className}`}
      data-role={message.role}
    >
      {/* Reasoning / thinking block */}
      {message.reasoning && (
        <ThinkingBlock content={message.reasoning} />
      )}

      {/* Tool executions */}
      {message.tools && message.tools.length > 0 && (
        <div className="wingman-message-tools">
          {message.tools.map((tool) => (
            <ToolStatus key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      )}

      {/* Message content */}
      <div className="wingman-message-content">
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>

      {/* Token usage */}
      {message.usage && (
        <div className="wingman-message-usage">
          <span>{message.usage.inputTokens.toLocaleString()} in</span>
          <span> / </span>
          <span>{message.usage.outputTokens.toLocaleString()} out</span>
        </div>
      )}
    </div>
  );
}
