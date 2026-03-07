/**
 * TokenUsage — Display input/output/cache token counts.
 *
 * Reads usage data from ChatProvider state.
 */

import React from 'react';
import type { UsageData } from '@wingman-chat/core';

export interface TokenUsageProps {
  usage: UsageData | null;
  className?: string;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TokenUsage({ usage, className = '' }: TokenUsageProps) {
  if (!usage) return null;

  return (
    <div className={`wingman-token-usage ${className}`}>
      <span className="wingman-token-usage-item" title="Input tokens">
        ↑ {formatTokenCount(usage.inputTokens)}
      </span>
      <span className="wingman-token-usage-item" title="Output tokens">
        ↓ {formatTokenCount(usage.outputTokens)}
      </span>
      {usage.cacheReadTokens != null && usage.cacheReadTokens > 0 && (
        <span className="wingman-token-usage-item" title="Cache read tokens">
          ⚡ {formatTokenCount(usage.cacheReadTokens)}
        </span>
      )}
    </div>
  );
}
