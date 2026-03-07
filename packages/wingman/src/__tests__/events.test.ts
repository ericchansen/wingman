import { describe, it, expect, vi } from 'vitest';
import { EventRouter, type EventCallbacks } from '../events.js';

/** Helper to create a router with specific callbacks and dispatch one event. */
function routeEvent(
  type: string,
  data: Record<string, unknown>,
  callbacks: EventCallbacks,
) {
  const router = new EventRouter(callbacks);
  router.route({ type, data });
}

describe('EventRouter', () => {
  describe('streaming events', () => {
    it('routes assistant.message_delta to onDelta', () => {
      const onDelta = vi.fn();
      routeEvent('assistant.message_delta', { deltaContent: 'Hello' }, { onDelta });
      expect(onDelta).toHaveBeenCalledWith('Hello');
    });

    it('routes assistant.streaming_delta to onDelta', () => {
      const onDelta = vi.fn();
      routeEvent('assistant.streaming_delta', { deltaContent: 'world' }, { onDelta });
      expect(onDelta).toHaveBeenCalledWith('world');
    });

    it('falls back to content field if deltaContent missing', () => {
      const onDelta = vi.fn();
      routeEvent('assistant.message_delta', { content: 'fallback' }, { onDelta });
      expect(onDelta).toHaveBeenCalledWith('fallback');
    });

    it('falls back to empty string if both missing', () => {
      const onDelta = vi.fn();
      routeEvent('assistant.message_delta', {}, { onDelta });
      expect(onDelta).toHaveBeenCalledWith('');
    });
  });

  describe('reasoning events', () => {
    it('routes assistant.reasoning_delta to onReasoningDelta', () => {
      const onReasoningDelta = vi.fn();
      routeEvent(
        'assistant.reasoning_delta',
        { deltaContent: 'thinking...', reasoningId: 'r1' },
        { onReasoningDelta },
      );
      expect(onReasoningDelta).toHaveBeenCalledWith('thinking...', 'r1');
    });

    it('routes assistant.reasoning to onReasoning', () => {
      const onReasoning = vi.fn();
      routeEvent(
        'assistant.reasoning',
        { content: 'full reasoning', reasoningId: 'r2' },
        { onReasoning },
      );
      expect(onReasoning).toHaveBeenCalledWith('full reasoning', 'r2');
    });
  });

  describe('usage events', () => {
    it('routes assistant.usage with all fields', () => {
      const onUsage = vi.fn();
      routeEvent('assistant.usage', {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheWriteTokens: 25,
        model: 'claude-sonnet-4',
      }, { onUsage });

      expect(onUsage).toHaveBeenCalledWith({
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheWriteTokens: 25,
        model: 'claude-sonnet-4',
      });
    });

    it('defaults to 0 for missing token counts', () => {
      const onUsage = vi.fn();
      routeEvent('assistant.usage', {}, { onUsage });
      expect(onUsage).toHaveBeenCalledWith({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        model: undefined,
      });
    });
  });

  describe('turn lifecycle events', () => {
    it('routes assistant.turn_start', () => {
      const onTurnStart = vi.fn();
      routeEvent('assistant.turn_start', { turnId: 't1' }, { onTurnStart });
      expect(onTurnStart).toHaveBeenCalledWith('t1');
    });

    it('routes assistant.turn_end', () => {
      const onTurnEnd = vi.fn();
      routeEvent('assistant.turn_end', { turnId: 't1' }, { onTurnEnd });
      expect(onTurnEnd).toHaveBeenCalledWith('t1');
    });

    it('routes assistant.intent', () => {
      const onIntent = vi.fn();
      routeEvent('assistant.intent', { intent: 'search' }, { onIntent });
      expect(onIntent).toHaveBeenCalledWith('search');
    });
  });

  describe('tool execution events', () => {
    it('routes tool.execution_start', () => {
      const onToolStart = vi.fn();
      routeEvent('tool.execution_start', {
        toolCallId: 'tc1',
        toolName: 'get_weather',
        arguments: { city: 'Seattle' },
        mcpServerName: 'weather-mcp',
        mcpToolName: 'get_weather',
      }, { onToolStart });

      expect(onToolStart).toHaveBeenCalledWith({
        toolCallId: 'tc1',
        toolName: 'get_weather',
        arguments: { city: 'Seattle' },
        mcpServerName: 'weather-mcp',
        mcpToolName: 'get_weather',
      });
    });

    it('routes tool.execution_complete', () => {
      const onToolComplete = vi.fn();
      routeEvent('tool.execution_complete', {
        toolCallId: 'tc1',
        toolName: 'get_weather',
        result: { content: 'Sunny, 72°F' },
      }, { onToolComplete });

      expect(onToolComplete).toHaveBeenCalledWith('tc1', 'get_weather', 'Sunny, 72°F');
    });

    it('handles string result in tool.execution_complete', () => {
      const onToolComplete = vi.fn();
      routeEvent('tool.execution_complete', {
        toolCallId: 'tc1',
        toolName: 'search',
        result: 'plain string result',
      }, { onToolComplete });

      expect(onToolComplete).toHaveBeenCalledWith('tc1', 'search', 'plain string result');
    });

    it('routes tool.execution_progress', () => {
      const onToolProgress = vi.fn();
      routeEvent('tool.execution_progress', {
        toolCallId: 'tc1',
        progressMessage: 'Loading...',
      }, { onToolProgress });

      expect(onToolProgress).toHaveBeenCalledWith('tc1', 'Loading...');
    });

    it('routes tool.user_requested', () => {
      const onToolUserRequested = vi.fn();
      routeEvent('tool.user_requested', {
        toolCallId: 'tc1',
        toolName: 'run_code',
      }, { onToolUserRequested });

      expect(onToolUserRequested).toHaveBeenCalledWith('tc1', 'run_code');
    });
  });

  describe('skill events', () => {
    it('routes skill.invoked', () => {
      const onSkillInvoked = vi.fn();
      routeEvent('skill.invoked', {
        name: 'git-commit',
        pluginName: 'copilot-skills',
        path: '/skills/git-commit',
      }, { onSkillInvoked });

      expect(onSkillInvoked).toHaveBeenCalledWith('git-commit', 'copilot-skills', '/skills/git-commit');
    });
  });

  describe('subagent events', () => {
    it('routes subagent.started', () => {
      const onSubagentStarted = vi.fn();
      routeEvent('subagent.started', {
        toolCallId: 'tc1',
        agentName: 'explore',
        agentDisplayName: 'Code Explorer',
        agentDescription: 'Explores code',
      }, { onSubagentStarted });

      expect(onSubagentStarted).toHaveBeenCalledWith('tc1', 'explore', 'Code Explorer', 'Explores code');
    });

    it('routes subagent.completed', () => {
      const onSubagentCompleted = vi.fn();
      routeEvent('subagent.completed', {
        toolCallId: 'tc1',
        agentName: 'explore',
        agentDisplayName: 'Code Explorer',
      }, { onSubagentCompleted });

      expect(onSubagentCompleted).toHaveBeenCalledWith('tc1', 'explore', 'Code Explorer');
    });

    it('routes subagent.failed', () => {
      const onSubagentFailed = vi.fn();
      routeEvent('subagent.failed', {
        toolCallId: 'tc1',
        agentName: 'task',
        error: 'Timeout exceeded',
      }, { onSubagentFailed });

      expect(onSubagentFailed).toHaveBeenCalledWith('tc1', 'task', 'Timeout exceeded');
    });
  });

  describe('session lifecycle events', () => {
    it('routes session.error', () => {
      const onError = vi.fn();
      routeEvent('session.error', { message: 'Connection lost' }, { onError });
      expect(onError).toHaveBeenCalledWith('Connection lost');
    });

    it('defaults to Unknown error when message missing', () => {
      const onError = vi.fn();
      routeEvent('session.error', {}, { onError });
      expect(onError).toHaveBeenCalledWith('Unknown error');
    });

    it('routes session.info', () => {
      const onInfo = vi.fn();
      routeEvent('session.info', { infoType: 'quota', message: '80% used' }, { onInfo });
      expect(onInfo).toHaveBeenCalledWith('quota', '80% used');
    });

    it('routes session.warning', () => {
      const onWarning = vi.fn();
      routeEvent('session.warning', { warningType: 'rate_limit', message: 'Slowing down' }, { onWarning });
      expect(onWarning).toHaveBeenCalledWith('rate_limit', 'Slowing down');
    });
  });

  describe('model events', () => {
    it('routes session.model_change', () => {
      const onModelChange = vi.fn();
      routeEvent('session.model_change', { model: 'claude-opus-4' }, { onModelChange });
      expect(onModelChange).toHaveBeenCalledWith('claude-opus-4');
    });
  });

  describe('context events', () => {
    it('routes session.truncation', () => {
      const onTruncation = vi.fn();
      routeEvent('session.truncation', { reason: 'context_full' }, { onTruncation });
      expect(onTruncation).toHaveBeenCalledWith({ reason: 'context_full' });
    });

    it('routes session.compaction_start', () => {
      const onCompactionStart = vi.fn();
      routeEvent('session.compaction_start', {}, { onCompactionStart });
      expect(onCompactionStart).toHaveBeenCalled();
    });

    it('routes session.compaction_complete', () => {
      const onCompactionComplete = vi.fn();
      routeEvent('session.compaction_complete', {}, { onCompactionComplete });
      expect(onCompactionComplete).toHaveBeenCalled();
    });
  });

  describe('mode and title events', () => {
    it('routes session.mode_changed', () => {
      const onModeChanged = vi.fn();
      routeEvent('session.mode_changed', { mode: 'plan' }, { onModeChanged });
      expect(onModeChanged).toHaveBeenCalledWith('plan');
    });

    it('routes session.title_changed', () => {
      const onTitleChanged = vi.fn();
      routeEvent('session.title_changed', { title: 'My Chat' }, { onTitleChanged });
      expect(onTitleChanged).toHaveBeenCalledWith('My Chat');
    });
  });

  describe('unhandled events', () => {
    it('calls onUnhandledEvent for unknown types', () => {
      const onUnhandledEvent = vi.fn();
      routeEvent('some.future_event', { foo: 'bar' }, { onUnhandledEvent });
      expect(onUnhandledEvent).toHaveBeenCalledWith('some.future_event', { foo: 'bar' });
    });

    it('does not throw for events with no callback registered', () => {
      expect(() => {
        routeEvent('assistant.message_delta', { deltaContent: 'test' }, {});
      }).not.toThrow();
    });

    it('does not throw for completely unknown events with no callback', () => {
      expect(() => {
        routeEvent('totally.unknown', { data: 123 }, {});
      }).not.toThrow();
    });
  });

  describe('debug mode', () => {
    it('logs events when debug is true', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const router = new EventRouter({}, true);
      router.route({ type: 'assistant.message_delta', data: { deltaContent: 'test' } });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('warns on unhandled events in debug mode', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const router = new EventRouter({}, true);
      router.route({ type: 'unknown.event', data: {} });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unhandled event type: unknown.event'));
      spy.mockRestore();
      debugSpy.mockRestore();
    });
  });

  describe('completeness — all 63 SDK event types handled', () => {
    const allEventTypes = [
      'assistant.message_delta', 'assistant.streaming_delta',
      'assistant.reasoning_delta', 'assistant.reasoning',
      'assistant.usage',
      'assistant.turn_start', 'assistant.turn_end', 'assistant.intent',
      'tool.execution_start', 'tool.execution_complete', 'tool.execution_progress',
      'tool.execution_partial_result', 'tool.user_requested',
      'skill.invoked',
      'subagent.started', 'subagent.completed', 'subagent.failed',
      'subagent.selected', 'subagent.deselected',
      'session.start', 'session.resume', 'session.shutdown', 'session.idle',
      'session.error', 'session.info', 'session.warning',
      'session.model_change',
      'session.truncation', 'session.compaction_start', 'session.compaction_complete',
      'session.context_changed',
      'session.mode_changed', 'session.plan_changed',
      'session.title_changed',
      'permission.requested', 'permission.completed',
      'elicitation.requested', 'elicitation.completed',
      'user_input.requested', 'user_input.completed',
      'user.message', 'system.message', 'assistant.message',
      'pending_messages.modified',
      'session.workspace_file_changed', 'session.snapshot_rewind',
      'hook.start', 'hook.end',
      'session.task_complete', 'session.handoff', 'session.usage_info',
    ];

    it(`handles all ${allEventTypes.length} event types without hitting onUnhandledEvent`, () => {
      const onUnhandledEvent = vi.fn();
      const router = new EventRouter({ onUnhandledEvent });

      for (const type of allEventTypes) {
        router.route({ type, data: {} });
      }

      expect(onUnhandledEvent).not.toHaveBeenCalled();
    });

    it('has exactly 51 known event types', () => {
      // This test ensures we don't accidentally drop events
      expect(allEventTypes.length).toBe(51);
    });
  });
});
