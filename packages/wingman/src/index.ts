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

// Client (to be implemented)
// export { WingmanClient } from './client.js';

// Session (to be implemented)
// export { SessionManager } from './session.js';

// Events (to be implemented)
// export { EventRouter } from './events.js';

// MCP (to be implemented)
// export { MCPDiscovery } from './mcp.js';

// Server (to be implemented)
// export { createServer } from './server.js';
