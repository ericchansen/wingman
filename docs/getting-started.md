# Getting Started

Build a chat application powered by [GitHub Copilot](https://github.com/features/copilot) in under a minute.

## Prerequisites

- **Node.js 20.11+** — [download](https://nodejs.org)
- **GitHub Copilot access** — your GitHub account needs a Copilot subscription

Optional:
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line) — enables automatic MCP server discovery from installed plugins

## Create a new app

```bash
npx create-wingman-app my-app
```

The CLI prompts for:
1. **Project name** — directory to create (default: `my-wingman-app`)
2. **Chat UI title** — displayed in the header
3. **System prompt** — the AI's personality and instructions

You can also pass the project name as an argument:

```bash
npx create-wingman-app sales-assistant
```

## Run it

```bash
cd my-app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you have a working chat.

## Customize

Edit `src/server.ts` to change any setting:

```typescript
import { startServer, defineConfig } from '@wingmanjs/core';

const config = defineConfig({
  systemPrompt: 'You are a sales intelligence assistant named Clippy...',
  model: 'claude-sonnet-4',
  server: { port: 3000 },
  ui: {
    title: 'Clippy Sales',
    theme: 'dark',
    welcomeMessage: "It looks like you're prepping for a meeting! 📎",
    suggestions: ['Show my pipeline', 'Brief me on Contoso'],
  },
});

await startServer({ config });
```

See [Configuration Reference](./configuration.md) for all available options.

## Add MCP servers

### Auto-discovery (recommended)

If you have the GitHub Copilot CLI installed, Wingman automatically discovers MCP servers from your installed plugins:

```bash
copilot plugin install mcaps-microsoft/MSX-MCP
copilot plugin install workiq@copilot-plugins
```

Restart your app — the servers are available immediately. No config needed.

### Manual configuration

Add servers directly in your config:

```typescript
const config = defineConfig({
  mcpServers: {
    'my-database': {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@my-org/db-mcp-server'],
      tools: ['*'],
    },
    'my-api': {
      type: 'http',
      url: 'https://api.example.com/mcp',
      tools: ['*'],
    },
  },
});
```

Manually configured servers are merged with auto-discovered ones. If both define a server with the same name, your manual config wins.

## Add tools

Pass SDK `Tool` objects to give the AI custom capabilities:

```typescript
import type { Tool } from '@github/copilot-sdk';

const weatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
  execute: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    return await res.json();
  },
};

const config = defineConfig({
  tools: [weatherTool],
});
```

## Build for production

```bash
npm run build
npm start
```

This compiles TypeScript to `dist/` and runs the compiled server with Node.js.

## Next steps

- [Configuration Reference](./configuration.md) — all config options with types, defaults, and examples
- [MCP Authentication](./mcp-auth.md) — OAuth setup for Fabric/Power BI and other protected MCP servers
- [Examples](../examples/hello-wingman/) — minimal working example
