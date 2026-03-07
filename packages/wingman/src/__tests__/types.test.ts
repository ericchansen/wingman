import { describe, it, expect } from 'vitest';
import {
  EVENT_CATEGORIES,
  type SDKEventType,
} from '../types.js';

describe('types', () => {
  describe('EVENT_CATEGORIES', () => {
    it('has an entry for every expected event type', () => {
      const expectedTypes: SDKEventType[] = [
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

      for (const type of expectedTypes) {
        expect(EVENT_CATEGORIES[type], `Missing category for ${type}`).toBeDefined();
      }
    });

    it('maps streaming events to streaming category', () => {
      expect(EVENT_CATEGORIES['assistant.message_delta']).toBe('streaming');
      expect(EVENT_CATEGORIES['assistant.streaming_delta']).toBe('streaming');
    });

    it('maps tool events to tool category', () => {
      expect(EVENT_CATEGORIES['tool.execution_start']).toBe('tool');
      expect(EVENT_CATEGORIES['tool.execution_complete']).toBe('tool');
      expect(EVENT_CATEGORIES['tool.execution_progress']).toBe('tool');
    });

    it('maps session events to session category', () => {
      expect(EVENT_CATEGORIES['session.error']).toBe('session');
      expect(EVENT_CATEGORIES['session.info']).toBe('session');
      expect(EVENT_CATEGORIES['session.warning']).toBe('session');
    });

    it('maps context events to context category', () => {
      expect(EVENT_CATEGORIES['session.truncation']).toBe('context');
      expect(EVENT_CATEGORIES['session.compaction_start']).toBe('context');
      expect(EVENT_CATEGORIES['session.compaction_complete']).toBe('context');
    });

    it('has no undefined categories', () => {
      for (const [type, category] of Object.entries(EVENT_CATEGORIES)) {
        expect(category, `Category for ${type} is undefined`).toBeDefined();
        expect(typeof category).toBe('string');
        expect(category.length).toBeGreaterThan(0);
      }
    });
  });
});
