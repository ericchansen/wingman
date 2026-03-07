# 🦜 Wingman

The open-source chat app for the [GitHub Copilot SDK](https://github.com/features/copilot).

```bash
npx create-wingman-app my-chat
cd my-chat
npm run dev
```

**One command → full-featured chat.** MCP servers auto-discovered, skills loaded, all 63 SDK event types handled, model switching, mode control, abort support — everything works out of the box.

## Why Wingman?

**No turnkey chat frontend exists for the GitHub Copilot SDK.** Every team building on the SDK writes their own streaming UI, event handling, session management, and MCP wiring from scratch. Wingman is the first project to package all of that into a complete, production-ready chat app.

### What's included

- **All 63 SDK event types** handled — token tracking, thinking blocks, tool status, context health
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
import { defineConfig } from 'wingman/config';

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
| `wingman` | [![npm](https://img.shields.io/npm/v/wingman)](https://npmjs.com/package/wingman) | Core SDK wrapper, session management, MCP discovery, Express server |
| `@wingman/react` | [![npm](https://img.shields.io/npm/v/@wingman/react)](https://npmjs.com/package/@wingman/react) | React 19 hooks + shadcn/ui components |
| `create-wingman-app` | [![npm](https://img.shields.io/npm/v/create-wingman-app)](https://npmjs.com/package/create-wingman-app) | Project scaffolding CLI |

## Quick Start

### Prerequisites

- Node.js 18+
- GitHub Copilot CLI (`copilot` command available)

### Create a new app

```bash
npx create-wingman-app my-chat
cd my-chat
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
import { defineConfig } from 'wingman/config';

export default defineConfig({
  // Agent behavior
  systemPrompt: 'You are a helpful assistant.',
  model: 'claude-sonnet-4',
  reasoningEffort: 'medium',

  // MCP servers (merged with auto-discovered servers)
  mcpServers: {},

  // Custom tools
  tools: ['./src/tools/*.ts'],

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
    transport: 'socketio',
  },

  // Observability (opt-in)
  telemetry: {
    enabled: false,
    exporter: 'console',
  },
});
```

## Architecture

```
React SPA (Vite) ──→ Socket.IO ──→ Express Server ──→ WingmanClient ──→ MCP Servers
                                                           │
                                                    CopilotClient
                                                     (SDK core)
```

Wingman follows the **"Thin App, Smart Agent"** pattern. The frontend is a thin rendering layer over the Copilot SDK — all intelligence lives in the SDK's agent core. Wingman's job is to faithfully render all SDK events and provide clean input/output channels.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
