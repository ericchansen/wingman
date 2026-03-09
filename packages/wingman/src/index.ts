/**
 * Wingman — Public API surface.
 *
 * Re-exports all public types, the client, session manager,
 * event router, MCP discovery, and configuration utilities.
 */

// Types
export type {
  SDKEventType,
  EventCategory,
  UsageData,
  ToolExecution,
  SessionInfo,
  AgentMode,
  ChatMessage,
  MessageSegment,
  MCPStdioConfig,
  MCPHttpConfig,
  MCPServerConfig,
  DiscoveredMCPServer,
  TransportType,
  TransportAdapter,
  WingmanUIConfig,
  WingmanServerConfig,
  WingmanTelemetryConfig,
  WingmanConfig,
} from './types.js';

// Constants
export { EVENT_CATEGORIES } from './types.js';

// Config
export { defineConfig, resolveConfig, DEFAULT_CONFIG } from './config.js';

// Client
export { WingmanClient } from './client.js';
export type { WingmanClientOptions, SendMessageOptions } from './client.js';

// Events
export { EventRouter } from './events.js';
export type { EventCallbacks } from './events.js';

// MCP
export { discoverMCPServers, discoverWithDiagnostics, getHttpServerAuthStatus, refreshAuthStatusForServer } from './mcp.js';
export type { DiscoveryResult } from './mcp.js';

// Auth (OAuth 2.0 for HTTP MCP servers)
export {
  startAuthFlow,
  waitForCallback,
  getValidToken,
  refreshToken,
  logout,
  getPendingFlows,
  shutdownCallbackServer,
} from './auth/index.js';
export type { OAuthServerConfig, McpServerAuth, StoredToken } from './auth/index.js';

// Server
export { createServer, startServer } from './server.js';
export type { CreateServerOptions, ServerInstance, RunningServerInstance } from './server.js';

// Telemetry
export { WingmanTracer, createTracer, createNoopCallbacks } from './telemetry.js';
export { initTelemetry, shutdownTelemetry } from './instrumentation.js';
