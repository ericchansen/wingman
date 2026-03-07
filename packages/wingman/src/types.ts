/**
 * Wingman — Core types for the GitHub Copilot SDK chat framework.
 *
 * These types define the public API surface. All 51 SDK event types are
 * represented, along with RPC method types, transport adapters, and
 * configuration schemas.
 */

// ---------------------------------------------------------------------------
// SDK Event Types (all 63)
// ---------------------------------------------------------------------------

/** Categories of SDK events for routing and filtering. */
export type EventCategory =
  | 'streaming'
  | 'reasoning'
  | 'usage'
  | 'turn'
  | 'tool'
  | 'skill'
  | 'subagent'
  | 'session'
  | 'model'
  | 'context'
  | 'mode'
  | 'title'
  | 'permission'
  | 'user_input'
  | 'message'
  | 'workspace'
  | 'hook'
  | 'task';

/** All 51 SDK event type strings. */
export type SDKEventType =
  // Streaming (2)
  | 'assistant.message_delta'
  | 'assistant.streaming_delta'
  // Reasoning (2)
  | 'assistant.reasoning_delta'
  | 'assistant.reasoning'
  // Usage (1)
  | 'assistant.usage'
  // Turn lifecycle (3)
  | 'assistant.turn_start'
  | 'assistant.turn_end'
  | 'assistant.intent'
  // Tool execution (5)
  | 'tool.execution_start'
  | 'tool.execution_complete'
  | 'tool.execution_progress'
  | 'tool.execution_partial_result'
  | 'tool.user_requested'
  // Skills (1)
  | 'skill.invoked'
  // Subagents (5)
  | 'subagent.started'
  | 'subagent.completed'
  | 'subagent.failed'
  | 'subagent.selected'
  | 'subagent.deselected'
  // Session lifecycle (7)
  | 'session.start'
  | 'session.resume'
  | 'session.shutdown'
  | 'session.idle'
  | 'session.error'
  | 'session.info'
  | 'session.warning'
  // Model (1)
  | 'session.model_change'
  // Context (4)
  | 'session.truncation'
  | 'session.compaction_start'
  | 'session.compaction_complete'
  | 'session.context_changed'
  // Mode (2)
  | 'session.mode_changed'
  | 'session.plan_changed'
  // Title (1)
  | 'session.title_changed'
  // Permission (2)
  | 'permission.requested'
  | 'permission.completed'
  // User input (4)
  | 'elicitation.requested'
  | 'elicitation.completed'
  | 'user_input.requested'
  | 'user_input.completed'
  // Messages (4)
  | 'user.message'
  | 'system.message'
  | 'assistant.message'
  | 'pending_messages.modified'
  // Workspace (2)
  | 'session.workspace_file_changed'
  | 'session.snapshot_rewind'
  // Hooks (2)
  | 'hook.start'
  | 'hook.end'
  // Task/handoff (3)
  | 'session.task_complete'
  | 'session.handoff'
  | 'session.usage_info';

/** Mapping of event types to their categories for routing. */
export const EVENT_CATEGORIES: Record<SDKEventType, EventCategory> = {
  'assistant.message_delta': 'streaming',
  'assistant.streaming_delta': 'streaming',
  'assistant.reasoning_delta': 'reasoning',
  'assistant.reasoning': 'reasoning',
  'assistant.usage': 'usage',
  'assistant.turn_start': 'turn',
  'assistant.turn_end': 'turn',
  'assistant.intent': 'turn',
  'tool.execution_start': 'tool',
  'tool.execution_complete': 'tool',
  'tool.execution_progress': 'tool',
  'tool.execution_partial_result': 'tool',
  'tool.user_requested': 'tool',
  'skill.invoked': 'skill',
  'subagent.started': 'subagent',
  'subagent.completed': 'subagent',
  'subagent.failed': 'subagent',
  'subagent.selected': 'subagent',
  'subagent.deselected': 'subagent',
  'session.start': 'session',
  'session.resume': 'session',
  'session.shutdown': 'session',
  'session.idle': 'session',
  'session.error': 'session',
  'session.info': 'session',
  'session.warning': 'session',
  'session.model_change': 'model',
  'session.truncation': 'context',
  'session.compaction_start': 'context',
  'session.compaction_complete': 'context',
  'session.context_changed': 'context',
  'session.mode_changed': 'mode',
  'session.plan_changed': 'mode',
  'session.title_changed': 'title',
  'permission.requested': 'permission',
  'permission.completed': 'permission',
  'elicitation.requested': 'user_input',
  'elicitation.completed': 'user_input',
  'user_input.requested': 'user_input',
  'user_input.completed': 'user_input',
  'user.message': 'message',
  'system.message': 'message',
  'assistant.message': 'message',
  'pending_messages.modified': 'message',
  'session.workspace_file_changed': 'workspace',
  'session.snapshot_rewind': 'workspace',
  'hook.start': 'hook',
  'hook.end': 'hook',
  'session.task_complete': 'task',
  'session.handoff': 'task',
  'session.usage_info': 'task',
};

// ---------------------------------------------------------------------------
// Event Data Types
// ---------------------------------------------------------------------------

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
}

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  result?: string;
  status: 'running' | 'complete' | 'error';
  startedAt: number;
  completedAt?: number;
}

export interface SessionInfo {
  sessionId: string;
  title?: string;
  model?: string;
  mode?: AgentMode;
  createdAt: number;
  updatedAt: number;
}

export type AgentMode = 'interactive' | 'plan' | 'autopilot';

// ---------------------------------------------------------------------------
// Chat Message Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Tool executions that occurred during this message. */
  tools?: ToolExecution[];
  /** Reasoning/thinking content. */
  reasoning?: string;
  /** Token usage for this turn. */
  usage?: UsageData;
}

// ---------------------------------------------------------------------------
// MCP Configuration
// ---------------------------------------------------------------------------

export interface MCPStdioConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Tool names to enable. Default: ["*"] (all). */
  tools: string[];
}

export interface MCPHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  /** Tool names to enable. Default: ["*"] (all). */
  tools: string[];
}

export type MCPServerConfig = MCPStdioConfig | MCPHttpConfig;

export interface DiscoveredMCPServer {
  name: string;
  config: MCPServerConfig;
  source: 'built-in' | 'global' | 'plugin' | 'project';
  status: 'connected' | 'disconnected' | 'error';
  toolCount?: number;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type TransportType = 'socketio' | 'sse';

export interface TransportAdapter {
  connect(url: string): void;
  disconnect(): void;
  send(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WingmanUIConfig {
  title?: string;
  theme?: 'dark' | 'light' | 'system';
  logo?: string;
  welcomeMessage?: string;
  suggestions?: string[];
  colors?: Record<string, string>;
  showTokenUsage?: boolean;
  showModelPicker?: boolean;
  showModeSwitcher?: boolean;
  showDebugPanel?: boolean;
}

export interface WingmanServerConfig {
  port?: number;
  /**
   * CORS configuration.
   * - `true`  — allow all origins (`*`). Fine for local dev; **unsafe in production**.
   * - `false` — disable CORS headers entirely.
   * - `string` — allow a single origin (e.g. `'https://myapp.com'`).
   * - `string[]` — allow multiple specific origins.
   *
   * @default true
   */
  cors?: boolean | string | string[];
  transport?: TransportType;
}

export interface WingmanTelemetryConfig {
  /** Enable OpenTelemetry tracing. Default: false (fully no-op when disabled). */
  enabled?: boolean;
  /** Trace exporter to use. Default: 'console'. */
  exporter?: 'console' | 'otlp';
  /** OTLP endpoint URL. Default: http://localhost:4318/v1/traces (Jaeger default). */
  endpoint?: string;
  /** OTel service.name attribute. Default: 'wingman'. */
  serviceName?: string;
  /** Capture tool arguments and results in span attributes. Off by default (sensitive data). */
  captureContent?: boolean;
}

export interface WingmanConfig {
  systemPrompt?: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  mcpServers?: Record<string, MCPServerConfig>;
  skillDirectories?: string[];
  customAgents?: string[];
  tools?: string[];
  ui?: WingmanUIConfig;
  server?: WingmanServerConfig;
  telemetry?: WingmanTelemetryConfig;
}
