# Configuration Reference

Wingman is configured via `defineConfig()` — a type-safe helper that provides autocomplete and validation.

```typescript
import { startServer, defineConfig } from '@wingmanjs/core';

const config = defineConfig({
  // ...options
});

await startServer({ config });
```

All options are optional. Wingman ships with sensible defaults for everything.

---

## Agent behavior

### `systemPrompt`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `'You are a helpful assistant.'` |

The system prompt sent to the model at the start of every conversation. This defines the AI's personality, capabilities, and constraints.

```typescript
defineConfig({
  systemPrompt: 'You are a sales intelligence assistant. Always cite data sources.',
});
```

### `model`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `'claude-sonnet-4'` |

The default model to use. Users can switch models from the UI if `showModelPicker` is enabled.

```typescript
defineConfig({
  model: 'gpt-4.1',
});
```

### `reasoningEffort`

| | |
|---|---|
| **Type** | `'low' \| 'medium' \| 'high' \| 'xhigh'` |
| **Default** | `'medium'` |

Controls how much "thinking" the model does before responding. Higher values produce more thorough responses but use more tokens.

```typescript
defineConfig({
  reasoningEffort: 'high',
});
```

---

## MCP servers

### `mcpServers`

| | |
|---|---|
| **Type** | `Record<string, MCPServerConfig>` |
| **Default** | `{}` |

Manually configured MCP servers. These are merged with auto-discovered servers from Copilot CLI plugins. If both define a server with the same name, the manual config takes precedence.

Each server is either `stdio` (runs a local process) or `http` (connects to a remote URL):

```typescript
defineConfig({
  mcpServers: {
    // stdio — runs a local command
    'my-database': {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@my-org/db-mcp-server'],
      env: { DB_URL: 'postgresql://localhost:5432/mydb' },
      tools: ['*'],
    },
    // http — connects to a remote server
    'my-api': {
      type: 'http',
      url: 'https://api.example.com/mcp',
      headers: { 'X-Api-Key': process.env.API_KEY! },
      tools: ['*'],
    },
  },
});
```

#### `MCPStdioConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'stdio'` | ✅ | Server transport type |
| `command` | `string` | ✅ | Command to run |
| `args` | `string[]` | — | Command arguments |
| `env` | `Record<string, string>` | — | Environment variables |
| `tools` | `string[]` | ✅ | Tool names to enable (`['*']` for all) |

#### `MCPHttpConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'http'` | ✅ | Server transport type |
| `url` | `string` | ✅ | Server URL |
| `headers` | `Record<string, string>` | — | HTTP headers |
| `tools` | `string[]` | ✅ | Tool names to enable (`['*']` for all) |

### `skillDirectories`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

Paths to directories containing skill definitions for the Copilot SDK.

```typescript
defineConfig({
  skillDirectories: ['./skills'],
});
```

### `customAgents`

| | |
|---|---|
| **Type** | `CustomAgentConfig[]` |
| **Default** | `[]` |

Custom agent configurations passed to the Copilot SDK.

---

## Tools

### `tools`

| | |
|---|---|
| **Type** | `Tool[]` (from `@github/copilot-sdk`) |
| **Default** | `[]` |

Custom tools to make available to the AI. Each tool defines a name, description, parameter schema, and an execute function.

```typescript
import type { Tool } from '@github/copilot-sdk';

const myTool: Tool = {
  name: 'lookup_customer',
  description: 'Look up customer details by ID',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Customer ID' },
    },
    required: ['id'],
  },
  execute: async ({ id }) => {
    return await db.customers.findById(id);
  },
};

defineConfig({
  tools: [myTool],
});
```

---

## Authentication

### `fabricAuth`

| | |
|---|---|
| **Type** | `'oauth' \| 'cli' \| 'inject' \| 'none'` |
| **Default** | `'oauth'` |

How to authenticate to remote HTTP MCP servers (Fabric/Power BI, etc.):

| Value | Description |
|-------|-------------|
| `'oauth'` | **(recommended)** Standalone OAuth 2.0 Authorization Code + PKCE. Probes each HTTP server for auth requirements, uses cached tokens, exposes `/api/auth/*` routes so users can sign in from the web UI. Works without the Copilot CLI installed. |
| `'cli'` | Don't inject tokens — assume the Copilot CLI subprocess handles auth via its own browser OAuth flow. |
| `'inject'` | Acquire a Fabric token via `az account get-access-token` and inject it as an Authorization header. Metadata-level access only (DAX ExecuteQuery fails with "Unauthorized"). |
| `'none'` | No auth injection. Servers must be public or pre-authenticated. |

See [MCP Authentication Guide](./mcp-auth.md) for detailed setup.

---

## UI

### `ui.title`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `'Wingman'` |

The title displayed in the chat header.

### `ui.theme`

| | |
|---|---|
| **Type** | `'dark' \| 'light' \| 'system'` |
| **Default** | `'system'` |

Color theme. `'system'` follows the user's OS preference.

### `ui.logo`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `undefined` |

Path or URL to a logo image displayed in the header.

### `ui.welcomeMessage`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `'How can I help?'` |

Message shown in the chat area before any conversation starts.

### `ui.suggestions`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

Clickable suggestion chips shown below the welcome message.

```typescript
defineConfig({
  ui: {
    suggestions: ['Show my pipeline', 'Brief me on Contoso', 'Draft an email'],
  },
});
```

### `ui.colors`

| | |
|---|---|
| **Type** | `Record<string, string>` |
| **Default** | `{}` |

Custom color overrides for the UI.

### `ui.showTokenUsage`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Show the live input/output token counter.

### `ui.showModelPicker`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Show the model switcher dropdown in the UI.

### `ui.showModeSwitcher`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Show the mode toggle (interactive / plan / autopilot).

### `ui.showDebugPanel`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

Show the debug panel with raw event stream data.

---

## Server

### `server.port`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `3000` |

The port the server listens on.

### `server.cors`

| | |
|---|---|
| **Type** | `boolean \| string \| string[]` |
| **Default** | `true` |

CORS configuration:
- `true` — allow all origins (`*`). Fine for local dev, unsafe in production.
- `false` — disable CORS headers entirely.
- `string` — allow a single origin (e.g. `'https://myapp.com'`).
- `string[]` — allow multiple specific origins.

### `server.transport`

| | |
|---|---|
| **Type** | `'sse' \| 'socketio'` |
| **Default** | `'sse'` |

Server transport protocol. SSE (Server-Sent Events) is the default and works in all modern browsers.

---

## Telemetry

OpenTelemetry tracing is fully opt-in. When disabled (the default), there is zero overhead.

### `telemetry.enabled`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

Enable OpenTelemetry tracing.

### `telemetry.exporter`

| | |
|---|---|
| **Type** | `'console' \| 'otlp'` |
| **Default** | `'console'` |

Where to send traces. Use `'otlp'` to send to Jaeger, Grafana Tempo, or other OTLP-compatible backends.

### `telemetry.endpoint`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `undefined` (uses `http://localhost:4318/v1/traces`) |

OTLP endpoint URL. Only used when `exporter` is `'otlp'`.

### `telemetry.serviceName`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `'wingman'` |

The `service.name` attribute in OpenTelemetry spans.

### `telemetry.captureContent`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

Capture tool arguments and results in span attributes. Off by default because these may contain sensitive data.

---

## Full example

```typescript
import { startServer, defineConfig } from '@wingmanjs/core';

const config = defineConfig({
  systemPrompt: 'You are a helpful sales assistant.',
  model: 'claude-sonnet-4',
  reasoningEffort: 'high',

  mcpServers: {
    'sales-data': {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@my-org/sales-mcp'],
      tools: ['*'],
    },
  },

  fabricAuth: 'oauth',

  ui: {
    title: 'Sales Assistant',
    theme: 'dark',
    welcomeMessage: 'Ready to help with your sales data!',
    suggestions: ['Show my pipeline', 'Top deals this month'],
    showTokenUsage: true,
    showModelPicker: true,
  },

  server: {
    port: 3000,
    cors: true,
  },

  telemetry: {
    enabled: true,
    exporter: 'otlp',
    endpoint: 'http://jaeger:4318/v1/traces',
  },
});

await startServer({ config });
```
