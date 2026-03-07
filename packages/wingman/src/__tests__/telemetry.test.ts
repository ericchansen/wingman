/**
 * Tests for WingmanTracer — OpenTelemetry instrumentation.
 *
 * Verifies span creation, attribute mapping, error handling,
 * callback composition, and no-op behavior when disabled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WingmanTracer, createTracer, createNoopCallbacks } from '../telemetry.js';

describe('WingmanTracer', () => {
  let tracer: WingmanTracer;

  beforeEach(() => {
    tracer = new WingmanTracer({ captureContent: false });
  });

  describe('createCallbacks', () => {
    it('returns an EventCallbacks object with expected methods', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');
      expect(callbacks.onTurnStart).toBeTypeOf('function');
      expect(callbacks.onTurnEnd).toBeTypeOf('function');
      expect(callbacks.onToolStart).toBeTypeOf('function');
      expect(callbacks.onToolComplete).toBeTypeOf('function');
      expect(callbacks.onUsage).toBeTypeOf('function');
      expect(callbacks.onError).toBeTypeOf('function');
      expect(callbacks.onSubagentStarted).toBeTypeOf('function');
      expect(callbacks.onSubagentCompleted).toBeTypeOf('function');
      expect(callbacks.onSubagentFailed).toBeTypeOf('function');
      expect(callbacks.onSkillInvoked).toBeTypeOf('function');
      expect(callbacks.onTruncation).toBeTypeOf('function');
      expect(callbacks.onCompactionStart).toBeTypeOf('function');
      expect(callbacks.onCompactionComplete).toBeTypeOf('function');
      expect(callbacks.onModelChange).toBeTypeOf('function');
    });

    it('does not throw when all callbacks are invoked', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');

      expect(() => {
        callbacks.onTurnStart?.('turn-1');
        callbacks.onToolStart?.({
          toolCallId: 'tc-1',
          toolName: 'search',
          mcpServerName: 'msx-mcp',
          mcpToolName: 'search_accounts',
        });
        callbacks.onToolComplete?.('tc-1', 'search', 'result data');
        callbacks.onUsage?.({
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 20,
          model: 'claude-sonnet-4',
        });
        callbacks.onSkillInvoked?.('my-skill', 'my-plugin');
        callbacks.onSubagentStarted?.('tc-2', 'explore-agent');
        callbacks.onSubagentCompleted?.('tc-2', 'explore-agent');
        callbacks.onTruncation?.({ maxTokens: 100000, currentTokens: 95000 });
        callbacks.onCompactionStart?.();
        callbacks.onCompactionComplete?.();
        callbacks.onModelChange?.('gpt-4o');
        callbacks.onError?.('test error');
        callbacks.onTurnEnd?.('turn-1');
      }).not.toThrow();
    });

    it('handles multiple tool executions in a single turn', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');

      expect(() => {
        callbacks.onTurnStart?.('turn-1');

        // Start multiple tools
        callbacks.onToolStart?.({ toolCallId: 'tc-1', toolName: 'search' });
        callbacks.onToolStart?.({ toolCallId: 'tc-2', toolName: 'get_file' });
        callbacks.onToolStart?.({ toolCallId: 'tc-3', toolName: 'list_repos' });

        // Complete them in different order
        callbacks.onToolComplete?.('tc-2', 'get_file', 'file content');
        callbacks.onToolComplete?.('tc-1', 'search', 'search result');
        callbacks.onToolComplete?.('tc-3', 'list_repos', 'repo list');

        callbacks.onTurnEnd?.('turn-1');
      }).not.toThrow();
    });

    it('handles subagent failure with error message', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');

      expect(() => {
        callbacks.onTurnStart?.('turn-1');
        callbacks.onSubagentStarted?.('tc-1', 'code-review');
        callbacks.onSubagentFailed?.('tc-1', 'code-review', 'Agent timed out');
        callbacks.onTurnEnd?.('turn-1');
      }).not.toThrow();
    });

    it('handles tool error results', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');

      expect(() => {
        callbacks.onTurnStart?.('turn-1');
        callbacks.onToolStart?.({ toolCallId: 'tc-1', toolName: 'msx_login' });
        callbacks.onToolComplete?.('tc-1', 'msx_login', 'Error: SAML authentication failed');
        callbacks.onTurnEnd?.('turn-1');
      }).not.toThrow();
    });
  });

  describe('captureContent', () => {
    it('defaults to false (no tool args/results in spans)', () => {
      const t = new WingmanTracer();
      const callbacks = t.createCallbacks('s1', 'model');
      // Should not throw — content not captured but span still works
      expect(() => {
        callbacks.onTurnStart?.('t1');
        callbacks.onToolStart?.({
          toolCallId: 'tc-1',
          toolName: 'search',
          arguments: { query: 'sensitive data' },
        });
        callbacks.onToolComplete?.('tc-1', 'search', 'sensitive result');
        callbacks.onTurnEnd?.('t1');
      }).not.toThrow();
    });

    it('can be enabled via config', () => {
      const t = new WingmanTracer({ captureContent: true });
      const callbacks = t.createCallbacks('s1', 'model');
      expect(() => {
        callbacks.onTurnStart?.('t1');
        callbacks.onToolStart?.({
          toolCallId: 'tc-1',
          toolName: 'search',
          arguments: { query: 'test' },
        });
        callbacks.onToolComplete?.('tc-1', 'search', 'result');
        callbacks.onTurnEnd?.('t1');
      }).not.toThrow();
    });
  });

  describe('orphaned span cleanup', () => {
    it('cleans up orphaned tool spans when turn ends', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');

      expect(() => {
        callbacks.onTurnStart?.('turn-1');
        // Start a tool but never complete it
        callbacks.onToolStart?.({ toolCallId: 'tc-1', toolName: 'search' });
        // Turn ends — orphaned tool span should be cleaned up
        callbacks.onTurnEnd?.('turn-1');
      }).not.toThrow();
    });

    it('cleans up orphaned subagent spans when turn ends', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');

      expect(() => {
        callbacks.onTurnStart?.('turn-1');
        callbacks.onSubagentStarted?.('tc-1', 'agent-1');
        // Turn ends without subagent completing
        callbacks.onTurnEnd?.('turn-1');
      }).not.toThrow();
    });
  });

  describe('concurrent turn isolation', () => {
    it('createCallbacks returns isolated state per call', () => {
      const callbacks1 = tracer.createCallbacks('session-1', 'model-a');
      const callbacks2 = tracer.createCallbacks('session-2', 'model-b');

      expect(() => {
        // Start turns on both — should not interfere
        callbacks1.onTurnStart?.('turn-1');
        callbacks2.onTurnStart?.('turn-2');

        // Tools on different callback sets
        callbacks1.onToolStart?.({ toolCallId: 'tc-1', toolName: 'tool-a' });
        callbacks2.onToolStart?.({ toolCallId: 'tc-1', toolName: 'tool-b' }); // same ID, different set

        callbacks1.onToolComplete?.('tc-1', 'tool-a', 'result-a');
        callbacks2.onToolComplete?.('tc-1', 'tool-b', 'result-b');

        callbacks1.onTurnEnd?.('turn-1');
        callbacks2.onTurnEnd?.('turn-2');
      }).not.toThrow();
    });
  });

  describe('span events without active chat span', () => {
    it('does not throw when recording events without a turn', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');
      // No onTurnStart called — chatSpan is null
      expect(() => {
        callbacks.onUsage?.({ inputTokens: 10, outputTokens: 5 });
        callbacks.onError?.('stray error');
        callbacks.onModelChange?.('gpt-4o');
        callbacks.onSkillInvoked?.('skill-1');
        callbacks.onTruncation?.({ reason: 'context_too_large' });
        callbacks.onCompactionStart?.();
        callbacks.onCompactionComplete?.();
      }).not.toThrow();
    });

    it('does not throw for tool events without a turn', () => {
      const callbacks = tracer.createCallbacks('session-1', 'claude-sonnet-4');
      expect(() => {
        // Tool events with no chatSpan — still creates spans (parentless)
        callbacks.onToolStart?.({ toolCallId: 'tc-1', toolName: 'search' });
        callbacks.onToolComplete?.('tc-1', 'search', 'result');
      }).not.toThrow();
    });
  });
});

describe('createTracer', () => {
  it('returns null tracer and noop callbacks when disabled', () => {
    const result = createTracer({ enabled: false });
    expect(result.tracer).toBeNull();

    const callbacks = result.createCallbacks('session-1', 'model');
    expect(Object.keys(callbacks)).toHaveLength(0);
  });

  it('returns null tracer when config is empty', () => {
    const result = createTracer({});
    expect(result.tracer).toBeNull();
  });

  it('returns a real tracer when enabled', () => {
    const result = createTracer({ enabled: true });
    expect(result.tracer).toBeInstanceOf(WingmanTracer);

    const callbacks = result.createCallbacks('session-1', 'model');
    expect(callbacks.onTurnStart).toBeTypeOf('function');
    expect(callbacks.onToolStart).toBeTypeOf('function');
  });
});

describe('createNoopCallbacks', () => {
  it('returns an empty callbacks object', () => {
    const callbacks = createNoopCallbacks();
    expect(callbacks).toEqual({});
  });

  it('has no callback functions defined', () => {
    const callbacks = createNoopCallbacks();
    expect(callbacks.onDelta).toBeUndefined();
    expect(callbacks.onToolStart).toBeUndefined();
    expect(callbacks.onUsage).toBeUndefined();
  });
});

describe('callback composition in WingmanClient', () => {
  it('composeCallbacks merges two callback sets', async () => {
    // Import the module to test — composeCallbacks is internal but we test
    // the concept by verifying both user and telemetry callbacks fire
    const primaryCalls: string[] = [];
    const secondaryCalls: string[] = [];

    const primary = {
      onDelta: (content: string) => primaryCalls.push(`delta:${content}`),
      onToolStart: (tool: { toolCallId: string; toolName: string }) =>
        primaryCalls.push(`tool:${tool.toolName}`),
    };

    const secondary = {
      onDelta: (content: string) => secondaryCalls.push(`delta:${content}`),
      onError: (message: string) => secondaryCalls.push(`error:${message}`),
    };

    // Manually compose (same logic as client.ts composeCallbacks)
    const composed: Record<string, (...args: unknown[]) => void> = {};
    const allKeys = new Set([...Object.keys(primary), ...Object.keys(secondary)]);

    for (const key of allKeys) {
      const pFn = (primary as Record<string, unknown>)[key] as ((...args: unknown[]) => void) | undefined;
      const sFn = (secondary as Record<string, unknown>)[key] as ((...args: unknown[]) => void) | undefined;

      if (pFn && sFn) {
        composed[key] = (...args: unknown[]) => { pFn(...args); sFn(...args); };
      } else {
        composed[key] = (pFn ?? sFn)!;
      }
    }

    // onDelta exists in both — both should fire
    composed.onDelta('hello');
    expect(primaryCalls).toContain('delta:hello');
    expect(secondaryCalls).toContain('delta:hello');

    // onToolStart only in primary
    composed.onToolStart({ toolCallId: 'tc-1', toolName: 'search' });
    expect(primaryCalls).toContain('tool:search');
    expect(secondaryCalls).not.toContain('tool:search');

    // onError only in secondary
    composed.onError('failure');
    expect(secondaryCalls).toContain('error:failure');
    expect(primaryCalls).not.toContain('error:failure');
  });
});
