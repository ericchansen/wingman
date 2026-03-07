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

import { trace, context, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
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

  /** Active chat span for the current sendMessage call. */
  private chatSpan: Span | null = null;
  /** Active tool spans keyed by toolCallId. */
  private toolSpans = new Map<string, Span>();
  /** Active subagent spans keyed by toolCallId. */
  private subagentSpans = new Map<string, Span>();

  constructor(config: WingmanTelemetryConfig = {}) {
    this.tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
    this.config = {
      captureContent: config.captureContent ?? false,
    };
  }

  /**
   * Create EventCallbacks that produce OTel spans.
   * These callbacks should be composed with user-provided callbacks
   * in WingmanClient.sendMessage().
   */
  createCallbacks(sessionId: string, model: string): EventCallbacks {
    return {
      onTurnStart: (_turnId: string) => {
        this.startChatSpan(sessionId, model);
      },

      onTurnEnd: (_turnId: string) => {
        this.endChatSpan();
      },

      onToolStart: (tool) => {
        this.startToolSpan(
          tool.toolCallId,
          tool.toolName,
          tool.mcpServerName,
          tool.mcpToolName,
          tool.arguments,
        );
      },

      onToolComplete: (toolCallId: string, toolName: string, result: string) => {
        this.endToolSpan(toolCallId, toolName, result);
      },

      onUsage: (usage) => {
        this.recordUsage(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.model);
      },

      onError: (message: string) => {
        this.recordError(message);
      },

      onSubagentStarted: (toolCallId: string, name: string) => {
        this.startSubagentSpan(toolCallId, name);
      },

      onSubagentCompleted: (toolCallId: string) => {
        this.endSubagentSpan(toolCallId);
      },

      onSubagentFailed: (toolCallId: string, _name: string, error?: string) => {
        this.endSubagentSpan(toolCallId, error);
      },

      onSkillInvoked: (name: string, pluginName?: string) => {
        this.recordSkillInvocation(name, pluginName);
      },

      onTruncation: (data: Record<string, unknown>) => {
        this.recordSpanEvent('context.truncation', data);
      },

      onCompactionStart: () => {
        this.recordSpanEvent('context.compaction_start');
      },

      onCompactionComplete: () => {
        this.recordSpanEvent('context.compaction_complete');
      },

      onModelChange: (model: string) => {
        if (this.chatSpan) {
          this.chatSpan.setAttribute(ATTR.GEN_AI_RESPONSE_MODEL, model);
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Span lifecycle
  // -------------------------------------------------------------------------

  /** Start the parent chat span for a sendMessage call. */
  private startChatSpan(sessionId: string, model: string): void {
    // End any existing chat span (shouldn't happen, but be safe)
    this.endChatSpan();

    this.chatSpan = this.tracer.startSpan(`chat ${model}`, {
      attributes: {
        [ATTR.GEN_AI_SYSTEM]: 'github.copilot',
        [ATTR.GEN_AI_OPERATION_NAME]: 'chat',
        [ATTR.GEN_AI_REQUEST_MODEL]: model,
        [ATTR.GEN_AI_CONVERSATION_ID]: sessionId,
      },
    });
  }

  /** End the parent chat span. */
  private endChatSpan(): void {
    if (this.chatSpan) {
      this.chatSpan.end();
      this.chatSpan = null;
    }
    // Clean up any orphaned child spans
    for (const [id, span] of this.toolSpans) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Orphaned tool span' });
      span.end();
      this.toolSpans.delete(id);
    }
    for (const [id, span] of this.subagentSpans) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Orphaned subagent span' });
      span.end();
      this.subagentSpans.delete(id);
    }
  }

  /** Start a child span for a tool execution. */
  private startToolSpan(
    toolCallId: string,
    toolName: string,
    mcpServerName?: string,
    mcpToolName?: string,
    args?: Record<string, unknown>,
  ): void {
    const parentContext = this.chatSpan
      ? trace.setSpan(context.active(), this.chatSpan)
      : context.active();

    const span = this.tracer.startSpan(
      `tools/call ${toolName}`,
      {
        attributes: {
          [ATTR.GEN_AI_SYSTEM]: 'github.copilot',
          [ATTR.GEN_AI_TOOL_NAME]: toolName,
          [ATTR.GEN_AI_TOOL_CALL_ID]: toolCallId,
          ...(mcpServerName && {
            [ATTR.MCP_SERVER_NAME]: mcpServerName,
            [ATTR.MCP_METHOD_NAME]: 'tools/call',
            [ATTR.NETWORK_TRANSPORT]: 'pipe',
          }),
          ...(mcpToolName && { 'mcp.tool.name': mcpToolName }),
          ...(this.config.captureContent && args && {
            'gen_ai.tool.call.arguments': JSON.stringify(args),
          }),
        },
      },
      parentContext,
    );

    this.toolSpans.set(toolCallId, span);
  }

  /** End a tool span, recording the result or error. */
  private endToolSpan(toolCallId: string, _toolName: string, result: string): void {
    const span = this.toolSpans.get(toolCallId);
    if (!span) return;

    // Detect error results from tool execution
    const isError = result.startsWith('Error:') || result.startsWith('error:');
    if (isError) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: result.slice(0, 200) });
      span.setAttribute(ATTR.ERROR_TYPE, 'tool_error');
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    if (this.config.captureContent && !isError) {
      span.setAttribute('gen_ai.tool.call.result', result.slice(0, 4096));
    }

    span.end();
    this.toolSpans.delete(toolCallId);
  }

  /** Start a child span for a subagent invocation. */
  private startSubagentSpan(toolCallId: string, agentName: string): void {
    const parentContext = this.chatSpan
      ? trace.setSpan(context.active(), this.chatSpan)
      : context.active();

    const span = this.tracer.startSpan(
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

    this.subagentSpans.set(toolCallId, span);
  }

  /** End a subagent span, optionally recording an error. */
  private endSubagentSpan(toolCallId: string, error?: string): void {
    const span = this.subagentSpans.get(toolCallId);
    if (!span) return;

    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error });
      span.setAttribute(ATTR.ERROR_TYPE, 'agent_error');
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
    this.subagentSpans.delete(toolCallId);
  }

  // -------------------------------------------------------------------------
  // Attribute recording
  // -------------------------------------------------------------------------

  /** Record token usage on the chat span. */
  private recordUsage(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
    model?: string,
  ): void {
    if (!this.chatSpan) return;

    this.chatSpan.setAttribute(ATTR.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    this.chatSpan.setAttribute(ATTR.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    if (cacheReadTokens != null) {
      this.chatSpan.setAttribute(ATTR.GEN_AI_USAGE_CACHE_READ_TOKENS, cacheReadTokens);
    }
    if (model) {
      this.chatSpan.setAttribute(ATTR.GEN_AI_RESPONSE_MODEL, model);
    }
  }

  /** Record an error on the chat span. */
  private recordError(message: string): void {
    if (!this.chatSpan) return;
    this.chatSpan.setStatus({ code: SpanStatusCode.ERROR, message });
    this.chatSpan.setAttribute(ATTR.ERROR_TYPE, 'session_error');
  }

  /** Record a skill invocation as a span event on the chat span. */
  private recordSkillInvocation(name: string, pluginName?: string): void {
    if (!this.chatSpan) return;
    this.chatSpan.addEvent('skill.invoked', {
      'skill.name': name,
      ...(pluginName && { 'skill.plugin': pluginName }),
    });
  }

  /** Record an arbitrary span event on the chat span. */
  private recordSpanEvent(name: string, attributes?: Record<string, unknown>): void {
    if (!this.chatSpan) return;
    // OTel span events only accept primitive attribute values
    const safeAttrs: Record<string, string | number | boolean> = {};
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          safeAttrs[key] = value;
        } else if (value != null) {
          safeAttrs[key] = JSON.stringify(value);
        }
      }
    }
    this.chatSpan.addEvent(name, safeAttrs);
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
