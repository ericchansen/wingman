/**
 * WingmanTracer — OpenTelemetry instrumentation for the Copilot SDK.
 *
 * Maps SDK SessionEvents → OTel spans following:
 * - GenAI semantic conventions (gen_ai.* attributes)
 * - MCP semantic conventions (mcp.* attributes)
 *
 * Designed to be fully no-op when telemetry is disabled.
 *
 * Span hierarchy:
 *   HTTP request span (auto from Express instrumentation)
 *     └─ chat {model}                    (parent — one per sendMessage call)
 *         ├─ tools/call {toolName}       (child — one per tool execution)
 *         ├─ invoke_agent {agentName}    (child — one per subagent)
 *         └─ skill {skillName}           (child — one per skill invocation)
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md
 */

import { trace, context, SpanStatusCode, type Span, type Tracer, type Attributes } from '@opentelemetry/api';
import type { WingmanTelemetryConfig } from './types.js';
import type { EventCallbacks } from './events.js';

const TRACER_NAME = 'wingman';
const TRACER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// GenAI + MCP semantic convention attribute keys
// ---------------------------------------------------------------------------

const ATTR = {
  // GenAI conventions
  GEN_AI_SYSTEM: 'gen_ai.system',
  GEN_AI_REQUEST_MODEL: 'gen_ai.request.model',
  GEN_AI_RESPONSE_MODEL: 'gen_ai.response.model',
  GEN_AI_CONVERSATION_ID: 'gen_ai.conversation.id',
  GEN_AI_OPERATION_NAME: 'gen_ai.operation.name',
  GEN_AI_USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  GEN_AI_USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  GEN_AI_USAGE_CACHE_READ_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
  GEN_AI_TOOL_NAME: 'gen_ai.tool.name',
  GEN_AI_TOOL_CALL_ID: 'gen_ai.tool.call.id',

  // MCP conventions
  MCP_METHOD_NAME: 'mcp.method.name',
  MCP_SERVER_NAME: 'mcp.server.name',
  MCP_SESSION_ID: 'mcp.session.id',
  NETWORK_TRANSPORT: 'network.transport',

  // Error conventions
  ERROR_TYPE: 'error.type',
} as const;

// ---------------------------------------------------------------------------
// WingmanTracer
// ---------------------------------------------------------------------------

export class WingmanTracer {
  private tracer: Tracer;
  private config: Required<Pick<WingmanTelemetryConfig, 'captureContent'>>;

  constructor(config: WingmanTelemetryConfig = {}) {
    this.tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
    this.config = {
      captureContent: config.captureContent ?? false,
    };
  }

  /**
   * Create EventCallbacks that produce OTel spans.
   * State is scoped per-call so concurrent sendMessage turns are isolated.
   */
  createCallbacks(sessionId: string, model: string): EventCallbacks {
    // Per-turn state — each sendMessage call gets isolated span tracking
    let chatSpan: Span | null = null;
    const toolSpans = new Map<string, Span>();
    const subagentSpans = new Map<string, Span>();

    const tracer = this.tracer;
    const captureContent = this.config.captureContent;

    // -- Span lifecycle helpers (close over per-turn state) --

    const startChatSpan = () => {
      endChatSpan();
      chatSpan = tracer.startSpan(`chat ${model}`, {
        attributes: {
          [ATTR.GEN_AI_SYSTEM]: 'github.copilot',
          [ATTR.GEN_AI_OPERATION_NAME]: 'chat',
          [ATTR.GEN_AI_REQUEST_MODEL]: model,
          [ATTR.GEN_AI_CONVERSATION_ID]: sessionId,
        },
      });
    };

    const endChatSpan = () => {
      if (chatSpan) {
        chatSpan.end();
        chatSpan = null;
      }
      for (const [id, span] of toolSpans) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Orphaned tool span' });
        span.end();
        toolSpans.delete(id);
      }
      for (const [id, span] of subagentSpans) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Orphaned subagent span' });
        span.end();
        subagentSpans.delete(id);
      }
    };

    const startToolSpan = (
      toolCallId: string,
      toolName: string,
      mcpServerName?: string,
      mcpToolName?: string,
      args?: Record<string, unknown>,
    ) => {
      const parentContext = chatSpan
        ? trace.setSpan(context.active(), chatSpan)
        : context.active();

      const attributes: Attributes = {
        [ATTR.GEN_AI_SYSTEM]: 'github.copilot',
        [ATTR.GEN_AI_TOOL_NAME]: toolName,
        [ATTR.GEN_AI_TOOL_CALL_ID]: toolCallId,
        ...(mcpServerName && {
          [ATTR.MCP_SERVER_NAME]: mcpServerName,
          [ATTR.MCP_METHOD_NAME]: 'tools/call',
          [ATTR.NETWORK_TRANSPORT]: 'pipe',
        }),
        ...(mcpToolName && { 'mcp.tool.name': mcpToolName }),
      };

      if (captureContent && args) {
        try {
          attributes['gen_ai.tool.call.arguments'] = JSON.stringify(args);
        } catch {
          attributes['gen_ai.tool.call.arguments'] = '[unserializable]';
        }
      }

      const span = tracer.startSpan(`tools/call ${toolName}`, { attributes }, parentContext);
      toolSpans.set(toolCallId, span);
    };

    const endToolSpan = (toolCallId: string, _toolName: string, result: string) => {
      const span = toolSpans.get(toolCallId);
      if (!span) return;

      const isError = result.startsWith('Error:') || result.startsWith('error:');
      if (isError) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.slice(0, 200) });
        span.setAttribute(ATTR.ERROR_TYPE, 'tool_error');
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      if (captureContent && !isError) {
        span.setAttribute('gen_ai.tool.call.result', result.slice(0, 4096));
      }

      span.end();
      toolSpans.delete(toolCallId);
    };

    const startSubagentSpan = (toolCallId: string, agentName: string) => {
      const parentContext = chatSpan
        ? trace.setSpan(context.active(), chatSpan)
        : context.active();

      const span = tracer.startSpan(
        `invoke_agent ${agentName}`,
        {
          attributes: {
            [ATTR.GEN_AI_SYSTEM]: 'github.copilot',
            [ATTR.GEN_AI_OPERATION_NAME]: 'invoke_agent',
            'gen_ai.agent.name': agentName,
          },
        },
        parentContext,
      );
      subagentSpans.set(toolCallId, span);
    };

    const endSubagentSpan = (toolCallId: string, error?: string) => {
      const span = subagentSpans.get(toolCallId);
      if (!span) return;

      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error });
        span.setAttribute(ATTR.ERROR_TYPE, 'agent_error');
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
      subagentSpans.delete(toolCallId);
    };

    const recordUsage = (
      inputTokens: number,
      outputTokens: number,
      cacheReadTokens?: number,
      responseModel?: string,
    ) => {
      if (!chatSpan) return;
      chatSpan.setAttribute(ATTR.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
      chatSpan.setAttribute(ATTR.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
      if (cacheReadTokens != null) {
        chatSpan.setAttribute(ATTR.GEN_AI_USAGE_CACHE_READ_TOKENS, cacheReadTokens);
      }
      if (responseModel) {
        chatSpan.setAttribute(ATTR.GEN_AI_RESPONSE_MODEL, responseModel);
      }
    };

    const recordError = (message: string) => {
      if (!chatSpan) return;
      chatSpan.setStatus({ code: SpanStatusCode.ERROR, message });
      chatSpan.setAttribute(ATTR.ERROR_TYPE, 'session_error');
    };

    const recordSkillInvocation = (name: string, pluginName?: string) => {
      if (!chatSpan) return;
      chatSpan.addEvent('skill.invoked', {
        'skill.name': name,
        ...(pluginName && { 'skill.plugin': pluginName }),
      });
    };

    const recordSpanEvent = (eventName: string, attributes?: Record<string, unknown>) => {
      if (!chatSpan) return;
      const safeAttrs: Record<string, string | number | boolean> = {};
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            safeAttrs[key] = value;
          } else if (value != null) {
            try {
              safeAttrs[key] = JSON.stringify(value);
            } catch {
              safeAttrs[key] = '[unserializable]';
            }
          }
        }
      }
      chatSpan.addEvent(eventName, safeAttrs);
    };

    // -- Return callbacks that close over per-turn state --

    return {
      onTurnStart: (_turnId: string) => startChatSpan(),
      onTurnEnd: (_turnId: string) => endChatSpan(),

      onToolStart: (tool) => {
        startToolSpan(tool.toolCallId, tool.toolName, tool.mcpServerName, tool.mcpToolName, tool.arguments);
      },
      onToolComplete: (toolCallId: string, toolName: string, result: string) => {
        endToolSpan(toolCallId, toolName, result);
      },

      onUsage: (usage) => {
        recordUsage(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.model);
      },

      onError: (message: string) => recordError(message),

      onSubagentStarted: (toolCallId: string, name: string) => startSubagentSpan(toolCallId, name),
      onSubagentCompleted: (toolCallId: string) => endSubagentSpan(toolCallId),
      onSubagentFailed: (toolCallId: string, _name: string, error?: string) => endSubagentSpan(toolCallId, error),

      onSkillInvoked: (name: string, pluginName?: string) => recordSkillInvocation(name, pluginName),

      onTruncation: (data: Record<string, unknown>) => recordSpanEvent('context.truncation', data),
      onCompactionStart: () => recordSpanEvent('context.compaction_start'),
      onCompactionComplete: () => recordSpanEvent('context.compaction_complete'),

      onModelChange: (newModel: string) => {
        if (chatSpan) {
          chatSpan.setAttribute(ATTR.GEN_AI_RESPONSE_MODEL, newModel);
        }
      },
    };
  }
}

// ---------------------------------------------------------------------------
// No-op tracer for when telemetry is disabled
// ---------------------------------------------------------------------------

/** Returns empty callbacks that do nothing — zero overhead. */
export function createNoopCallbacks(): EventCallbacks {
  return {};
}

/**
 * Create a tracer (or no-op) based on config.
 * Call this at startup; returns the tracer + its callbacks.
 */
export function createTracer(
  config: WingmanTelemetryConfig = {},
): { tracer: WingmanTracer | null; createCallbacks: (sessionId: string, model: string) => EventCallbacks } {
  if (!config.enabled) {
    return {
      tracer: null,
      createCallbacks: () => createNoopCallbacks(),
    };
  }

  const tracer = new WingmanTracer(config);
  return {
    tracer,
    createCallbacks: (sessionId: string, model: string) =>
      tracer.createCallbacks(sessionId, model),
  };
}
