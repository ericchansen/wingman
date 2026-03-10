# 🦜 Wingman

The open-source chat app for the [GitHub Copilot SDK](https://github.com/features/copilot).

```bash
git clone https://github.com/ericchansen/wingman.git
cd wingman && pnpm install && pnpm dev
```

**One command → full-featured chat.** MCP servers auto-discovered, skills loaded, all 51 SDK event types handled, model switching, mode control, abort support — everything works out of the box.

## Why Wingman?

**No turnkey chat frontend exists for the GitHub Copilot SDK.** Every team building on the SDK writes their own streaming UI, event handling, session management, and MCP wiring from scratch. Wingman is the first project to package all of that into a complete, production-ready chat app.

### What's included

- **All 51 SDK event types** handled — token tracking, thinking blocks, tool status, context health
- **MCP server auto-discovery** from Copilot CLI plugins — zero config
- **Skills and agents** wired automatically
- **Model switching** — pick any available model from the UI
- **Mode control** — interactive / plan / autopilot toggle
- **Session persistence** — chat history with auto-naming
- **Abort support** — cancel in-flight requests
- **Token usage** — live input/output token counter
- **Context health** — truncation and compaction warnings
- **OpenTelemetry** — built-in observability (opt-in)
- **Theming** — dark/light/system, fully customizable via config
- **Easy skinning** — swap colors, logo, system prompt in < 10 lines of config

### The boring default

Out of the box, Wingman is intentionally boring — a clean, generic chat interface. This makes it trivial to skin for your use case:

```typescript
// wingman.config.ts
import { defineConfig } from '@wingmanjs/core/config';

export default defineConfig({
  systemPrompt: 'You are a sales intelligence assistant named Clippy...',
  ui: {
    title: 'Clippy Sales',
    logo: './clippy-icon.svg',
    theme: 'dark',
    welcomeMessage: "It looks like you're prepping for a meeting! 📎",
    suggestions: ['Show my pipeline', 'Brief me on Contoso'],
  },
});
```

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@wingmanjs/core` | [![npm](https://img.shields.io/npm/v/@wingmanjs/core)](https://npmjs.com/package/@wingmanjs/core) | Core SDK wrapper, session management, MCP discovery, Express server |
| `@wingmanjs/react` | [![npm](https://img.shields.io/npm/v/@wingmanjs/react)](https://npmjs.com/package/@wingmanjs/react) | React 19 hooks + shadcn/ui components |
| `create-wingman-app` | [![npm](https://img.shields.io/npm/v/create-wingman-app)](https://npmjs.com/package/create-wingman-app) | Project scaffolding CLI |

## Quick Start

### Prerequisites

- Node.js 20.11+
- GitHub Copilot CLI (optional — enables plugin-based MCP server discovery)

### Create a new app

```bash
npx create-wingman-app my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:3000` — you have a working chat.

### Install MCP server plugins (optional)

Wingman auto-discovers MCP servers from installed Copilot CLI plugins:

```bash
copilot plugin install mcaps-microsoft/MSX-MCP    # Sales data
copilot plugin install workiq@copilot-plugins      # M365 data
```

Restart your app — the new tools appear automatically.

## Configuration

Everything is controlled via `wingman.config.ts`:

```typescript
import { defineConfig } from '@wingmanjs/core/config';

export default defineConfig({
  // Agent behavior
  systemPrompt: 'You are a helpful assistant.',
  model: 'claude-sonnet-4',
  reasoningEffort: 'medium',

  // MCP servers (merged with auto-discovered servers)
  mcpServers: {},

  // Custom tools (Tool[] from @github/copilot-sdk)
  tools: [],

  // UI
  ui: {
    title: 'Wingman',
    theme: 'system',
    showTokenUsage: true,
    showModelPicker: true,
    showModeSwitcher: true,
    showDebugPanel: false,
  },

  // Server
  server: {
    port: 3000,
    transport: 'sse',
  },

  // Observability (opt-in)
  telemetry: {
    enabled: false,
    exporter: 'console',
  },
});
```

> **Security note:** CORS is enabled by default (`cors: true`) with `Access-Control-Allow-Origin: *`. This is fine for local development but should be restricted or disabled for production deployments with authentication.

## Architecture

```
React SPA (Vite) ──→ SSE ──→ Express Server ──→ WingmanClient ──→ MCP Servers
                                                           │
                                                    CopilotClient
                                                     (SDK core)
```

Wingman follows the **"Thin App, Smart Agent"** pattern. The frontend is a thin rendering layer over the Copilot SDK — all intelligence lives in the SDK's agent core. Wingman's job is to faithfully render all SDK events and provide clean input/output channels.

## Local OTel Debugging

Wingman emits OpenTelemetry spans for every chat turn, tool call, subagent, and MCP discovery stage. To see them locally:

### Option A — Console (zero setup)

```typescript
// wingman.config.ts
export default defineConfig({
  telemetry: { enabled: true, exporter: 'console' },
});
```

Spans print to stdout in JSON on every request.

### Option B — Jaeger (recommended for tracing UI)

```bash
docker run -d --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

```typescript
export default defineConfig({
  telemetry: {
    enabled: true,
    exporter: 'otlp',
    endpoint: 'http://localhost:4318/v1/traces',
  },
});
```

Open `http://localhost:16686` → select service `wingman`.

### Option C — .NET Aspire Dashboard

```bash
docker run -d --name aspire \
  -p 18888:18888 -p 4318:18890 \
  mcr.microsoft.com/dotnet/aspire-dashboard:latest
```

```typescript
export default defineConfig({
  telemetry: {
    enabled: true,
    exporter: 'otlp',
    endpoint: 'http://localhost:4318/v1/traces',
    serviceName: 'wingman',
  },
});
```

Open `http://localhost:18888`.

### What's traced

| Span | Description |
|------|-------------|
| `{METHOD} {ROUTE}` (auto) | Every HTTP request from Express auto-instrumentation (e.g. `GET /api/chat`) |
| `chat {model}` | One per `sendMessage` call — contains token usage |
| `tools/call {toolName}` | One per tool execution, child of chat span |
| `invoke_agent {agentName}` | One per subagent, child of chat span |
| `mcp.discovery` | Full MCP server discovery run |
| `mcp.discovery.stage1_builtins` … `stage5` | Per-stage child spans |
| `mcp.connect` | MCP server connection lifecycle |

## MCP Server Authentication

Wingman automatically handles OAuth token injection for remote MCP servers (e.g., Power BI). It reads cached tokens from the Copilot CLI's OAuth cache (`~/.copilot/mcp-oauth-config/`), falling back to `az` CLI.

See **[docs/mcp-auth.md](docs/mcp-auth.md)** for the full guide, including:
- The three-tier token acquisition strategy
- The Power BI two-token problem (audience + appid)
- JWT debugging cheat sheet
- How to add auth for custom MCP servers

Quick config:

```typescript
export default defineConfig({
  // 'oauth' (default) — standalone OAuth 2.0 PKCE, works without Copilot CLI
  // 'cli' — let the SDK subprocess handle auth (requires interactive terminal)
  // 'inject' — use az CLI token (metadata-only access)
  // 'none' — no auth injection
  fabricAuth: 'oauth',
});
```

## Documentation

- [Getting Started](docs/getting-started.md) — create and run your first Wingman app
- [Configuration Reference](docs/configuration.md) — all config options with types, defaults, and examples
- [MCP Authentication](docs/mcp-auth.md) — OAuth setup for Fabric/Power BI and other protected MCP servers
- [hello-wingman example](examples/hello-wingman/) — minimal 20-line example

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
