# hello-wingman

Minimal Wingman chat application — ~20 lines of code.

## What this does

Starts a fully-featured chat server with the default configuration: Claude Sonnet model, SSE transport, auto-discovered MCP servers, and the built-in web UI on port 3000.

## Run it

From the monorepo root:

```bash
pnpm install
pnpm dev
```

Or run this example directly:

```bash
cd examples/hello-wingman
npx tsx src/server.ts
```

Open [http://localhost:3000](http://localhost:3000).

## Customize

Edit `src/server.ts` to change the system prompt, model, UI title, theme, or any other option. See the [Configuration Reference](../../docs/configuration.md) for all available settings.

## Start from scratch

Want your own standalone project (not in the monorepo)?

```bash
npx create-wingman-app my-app
cd my-app
npm install
npm run dev
```
