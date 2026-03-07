/**
 * EventRouter — Routes all 51 SDK event types to typed callbacks.
 *
 * Clean-room implementation that exhaustively handles every event type
 * the Copilot SDK emits. No event is silently dropped.
 */

import type { SDKEventType, UsageData, ToolExecution } from './types.js';

// ---------------------------------------------------------------------------
// Callback signatures for each event category
// ---------------------------------------------------------------------------

export interface EventCallbacks {
  // Streaming
  onDelta?: (content: string) => void;

  // Reasoning
  onReasoningDelta?: (content: string, reasoningId?: string) => void;
  onReasoning?: (content: string, reasoningId?: string) => void;

  // Usage
  onUsage?: (usage: UsageData) => void;

  // Turn lifecycle
  onTurnStart?: (turnId: string) => void;
  onTurnEnd?: (turnId: string) => void;
  onIntent?: (intent: string) => void;

  // Tool execution
  onToolStart?: (tool: Pick<ToolExecution, 'toolCallId' | 'toolName' | 'arguments'> & {
    mcpServerName?: string;
    mcpToolName?: string;
  }) => void;
  onToolComplete?: (toolCallId: string, toolName: string, result: string) => void;
  onToolProgress?: (toolCallId: string, message: string) => void;
  onToolPartialResult?: (toolCallId: string, result: string) => void;
  onToolUserRequested?: (toolCallId: string, toolName: string) => void;

  // Skills
  onSkillInvoked?: (name: string, pluginName?: string, path?: string) => void;

  // Subagents
  onSubagentStarted?: (toolCallId: string, name: string, displayName?: string, description?: string) => void;
  onSubagentCompleted?: (toolCallId: string, name: string, displayName?: string) => void;
  onSubagentFailed?: (toolCallId: string, name: string, error?: string) => void;
  onSubagentSelected?: (name: string) => void;
  onSubagentDeselected?: (name: string) => void;

  // Session lifecycle
  onSessionStart?: (sessionId: string) => void;
  onSessionResume?: (sessionId: string) => void;
  onSessionShutdown?: () => void;
  onSessionIdle?: () => void;
  onError?: (message: string) => void;
  onInfo?: (infoType: string, message: string) => void;
  onWarning?: (warningType: string, message: string) => void;

  // Model
  onModelChange?: (model: string) => void;

  // Context
  onTruncation?: (data: Record<string, unknown>) => void;
  onCompactionStart?: () => void;
  onCompactionComplete?: () => void;
  onContextChanged?: (data: Record<string, unknown>) => void;

  // Mode
  onModeChanged?: (mode: string) => void;
  onPlanChanged?: (plan: unknown) => void;

  // Title
  onTitleChanged?: (title: string) => void;

  // Permission
  onPermissionRequested?: (data: Record<string, unknown>) => void;
  onPermissionCompleted?: (data: Record<string, unknown>) => void;

  // User input / elicitation
  onElicitationRequested?: (data: Record<string, unknown>) => void;
  onElicitationCompleted?: (data: Record<string, unknown>) => void;
  onUserInputRequested?: (data: Record<string, unknown>) => void;
  onUserInputCompleted?: (data: Record<string, unknown>) => void;

  // Messages
  onUserMessage?: (content: string) => void;
  onSystemMessage?: (content: string) => void;
  onAssistantMessage?: (content: string) => void;
  onPendingMessagesModified?: (data: Record<string, unknown>) => void;

  // Workspace
  onWorkspaceFileChanged?: (path: string) => void;
  onSnapshotRewind?: (data: Record<string, unknown>) => void;

  // Hooks
  onHookStart?: (name: string) => void;
  onHookEnd?: (name: string) => void;

  // Task management
  onTaskComplete?: (data: Record<string, unknown>) => void;
  onHandoff?: (data: Record<string, unknown>) => void;
  onUsageInfo?: (data: Record<string, unknown>) => void;

  // Catch-all for unrecognized events (future SDK versions)
  onUnhandledEvent?: (type: string, data: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// EventRouter
// ---------------------------------------------------------------------------

export class EventRouter {
  private callbacks: EventCallbacks;
  private debug: boolean;

  constructor(callbacks: EventCallbacks, debug = false) {
    this.callbacks = callbacks;
    this.debug = debug || process.env.DEBUG_EVENTS === '1';
  }

  /**
   * Route a SessionEvent to the appropriate callback.
   * Every event type is explicitly handled — nothing is silently dropped.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route(event: { type: string; data?: any }): void {
    const { type, data } = event;

    if (this.debug) {
      const preview = JSON.stringify(data ?? {}).slice(0, 200);
      console.debug(`[event] ${type}: ${preview}`);
    }

    switch (type as SDKEventType) {
      // Streaming
      case 'assistant.message_delta':
      case 'assistant.streaming_delta':
        this.callbacks.onDelta?.(data?.deltaContent ?? data?.content ?? '');
        break;

      // Reasoning
      case 'assistant.reasoning_delta':
        this.callbacks.onReasoningDelta?.(data?.deltaContent ?? '', data?.reasoningId);
        break;
      case 'assistant.reasoning':
        this.callbacks.onReasoning?.(data?.content ?? '', data?.reasoningId);
        break;

      // Usage
      case 'assistant.usage':
        this.callbacks.onUsage?.({
          inputTokens: data?.inputTokens ?? 0,
          outputTokens: data?.outputTokens ?? 0,
          cacheReadTokens: data?.cacheReadTokens,
          cacheWriteTokens: data?.cacheWriteTokens,
          model: data?.model,
        });
        break;

      // Turn lifecycle
      case 'assistant.turn_start':
        this.callbacks.onTurnStart?.(data?.turnId ?? '');
        break;
      case 'assistant.turn_end':
        this.callbacks.onTurnEnd?.(data?.turnId ?? '');
        break;
      case 'assistant.intent':
        this.callbacks.onIntent?.(data?.intent ?? '');
        break;

      // Tool execution
      case 'tool.execution_start':
        this.callbacks.onToolStart?.({
          toolCallId: data?.toolCallId ?? '',
          toolName: data?.toolName ?? '',
          arguments: data?.arguments,
          mcpServerName: data?.mcpServerName,
          mcpToolName: data?.mcpToolName,
        });
        break;
      case 'tool.execution_complete': {
        let resultStr = '';
        if (data?.result != null) {
          if (typeof data.result === 'object') {
            const content = data.result.content ?? data.result;
            resultStr = typeof content === 'string' ? content : JSON.stringify(content);
          } else {
            resultStr = String(data.result);
          }
        }
        this.callbacks.onToolComplete?.(
          data?.toolCallId ?? '',
          data?.toolName ?? '',
          resultStr,
        );
        break;
      }
      case 'tool.execution_progress':
        this.callbacks.onToolProgress?.(data?.toolCallId ?? '', data?.progressMessage ?? '');
        break;
      case 'tool.execution_partial_result':
        this.callbacks.onToolPartialResult?.(data?.toolCallId ?? '', String(data?.result ?? ''));
        break;
      case 'tool.user_requested':
        this.callbacks.onToolUserRequested?.(data?.toolCallId ?? '', data?.toolName ?? '');
        break;

      // Skills
      case 'skill.invoked':
        this.callbacks.onSkillInvoked?.(data?.name ?? '', data?.pluginName, data?.path);
        break;

      // Subagents
      case 'subagent.started':
        this.callbacks.onSubagentStarted?.(data?.toolCallId ?? '', data?.agentName ?? '', data?.agentDisplayName, data?.agentDescription);
        break;
      case 'subagent.completed':
        this.callbacks.onSubagentCompleted?.(data?.toolCallId ?? '', data?.agentName ?? '', data?.agentDisplayName);
        break;
      case 'subagent.failed':
        this.callbacks.onSubagentFailed?.(data?.toolCallId ?? '', data?.agentName ?? '', data?.error);
        break;
      case 'subagent.selected':
        this.callbacks.onSubagentSelected?.(data?.agentName ?? data?.name ?? '');
        break;
      case 'subagent.deselected':
        this.callbacks.onSubagentDeselected?.(data?.agentName ?? data?.name ?? '');
        break;

      // Session lifecycle
      case 'session.start':
        this.callbacks.onSessionStart?.(data?.sessionId ?? '');
        break;
      case 'session.resume':
        this.callbacks.onSessionResume?.(data?.sessionId ?? '');
        break;
      case 'session.shutdown':
        this.callbacks.onSessionShutdown?.();
        break;
      case 'session.idle':
        this.callbacks.onSessionIdle?.();
        break;
      case 'session.error':
        this.callbacks.onError?.(data?.message ?? 'Unknown error');
        break;
      case 'session.info':
        this.callbacks.onInfo?.(data?.infoType ?? '', data?.message ?? '');
        break;
      case 'session.warning':
        this.callbacks.onWarning?.(data?.warningType ?? '', data?.message ?? '');
        break;

      // Model
      case 'session.model_change':
        this.callbacks.onModelChange?.(data?.model ?? '');
        break;

      // Context
      case 'session.truncation':
        this.callbacks.onTruncation?.(data ?? {});
        break;
      case 'session.compaction_start':
        this.callbacks.onCompactionStart?.();
        break;
      case 'session.compaction_complete':
        this.callbacks.onCompactionComplete?.();
        break;
      case 'session.context_changed':
        this.callbacks.onContextChanged?.(data ?? {});
        break;

      // Mode
      case 'session.mode_changed':
        this.callbacks.onModeChanged?.(data?.mode ?? '');
        break;
      case 'session.plan_changed':
        this.callbacks.onPlanChanged?.(data?.plan ?? data ?? {});
        break;

      // Title
      case 'session.title_changed':
        this.callbacks.onTitleChanged?.(data?.title ?? '');
        break;

      // Permission
      case 'permission.requested':
        this.callbacks.onPermissionRequested?.(data ?? {});
        break;
      case 'permission.completed':
        this.callbacks.onPermissionCompleted?.(data ?? {});
        break;

      // User input / elicitation
      case 'elicitation.requested':
        this.callbacks.onElicitationRequested?.(data ?? {});
        break;
      case 'elicitation.completed':
        this.callbacks.onElicitationCompleted?.(data ?? {});
        break;
      case 'user_input.requested':
        this.callbacks.onUserInputRequested?.(data ?? {});
        break;
      case 'user_input.completed':
        this.callbacks.onUserInputCompleted?.(data ?? {});
        break;

      // Messages
      case 'user.message':
        this.callbacks.onUserMessage?.(data?.content ?? '');
        break;
      case 'system.message':
        this.callbacks.onSystemMessage?.(data?.content ?? '');
        break;
      case 'assistant.message':
        this.callbacks.onAssistantMessage?.(data?.content ?? '');
        break;
      case 'pending_messages.modified':
        this.callbacks.onPendingMessagesModified?.(data ?? {});
        break;

      // Workspace
      case 'session.workspace_file_changed':
        this.callbacks.onWorkspaceFileChanged?.(data?.path ?? '');
        break;
      case 'session.snapshot_rewind':
        this.callbacks.onSnapshotRewind?.(data ?? {});
        break;

      // Hooks
      case 'hook.start':
        this.callbacks.onHookStart?.(data?.name ?? '');
        break;
      case 'hook.end':
        this.callbacks.onHookEnd?.(data?.name ?? '');
        break;

      // Task management
      case 'session.task_complete':
        this.callbacks.onTaskComplete?.(data ?? {});
        break;
      case 'session.handoff':
        this.callbacks.onHandoff?.(data ?? {});
        break;
      case 'session.usage_info':
        this.callbacks.onUsageInfo?.(data ?? {});
        break;

      // Catch-all — future SDK events won't be silently lost
      default:
        this.callbacks.onUnhandledEvent?.(type, data ?? {});
        if (this.debug) {
          console.warn(`[event] Unhandled event type: ${type}`);
        }
        break;
    }
  }
}
