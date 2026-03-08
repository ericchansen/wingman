/**
 * Wingman configuration loader.
 *
 * Provides `defineConfig()` for type-safe configuration and `resolveConfig()`
 * to deep-merge user config with defaults.
 */

import type { WingmanConfig } from './types.js';

/** Type-safe config helper — provides autocomplete and validation. */
export function defineConfig(config: WingmanConfig): WingmanConfig {
  return config;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: Required<WingmanConfig> = {
  systemPrompt: 'You are a helpful assistant.',
  model: 'claude-sonnet-4',
  reasoningEffort: 'medium',
  mcpServers: {},
  skillDirectories: [],
  customAgents: [],
  tools: [],
  ui: {
    title: 'Wingman',
    theme: 'system',
    logo: undefined,
    welcomeMessage: 'How can I help?',
    suggestions: [],
    colors: {},
    showTokenUsage: true,
    showModelPicker: true,
    showModeSwitcher: true,
    showDebugPanel: false,
  },
  server: {
    port: 3000,
    cors: true,
    transport: 'sse',
  },
  telemetry: {
    enabled: false,
    exporter: 'console',
    endpoint: undefined,
    serviceName: 'wingman',
    captureContent: false,
  },
};

/** Deep-merge user config with defaults. */
export function resolveConfig(userConfig: WingmanConfig): Required<WingmanConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    mcpServers: { ...DEFAULT_CONFIG.mcpServers, ...userConfig.mcpServers },
    ui: { ...DEFAULT_CONFIG.ui, ...userConfig.ui },
    server: { ...DEFAULT_CONFIG.server, ...userConfig.server },
    telemetry: { ...DEFAULT_CONFIG.telemetry, ...userConfig.telemetry },
  };
}
