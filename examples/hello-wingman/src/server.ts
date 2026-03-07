/**
 * hello-wingman — Minimal Wingman example.
 *
 * Run: npx tsx src/server.ts
 * Open: http://localhost:3000
 */

import { startServer, defineConfig } from '@wingman-chat/core';

const config = defineConfig({
  systemPrompt: 'You are a helpful assistant. Be concise and friendly.',
  server: { port: 3000 },
  ui: {
    title: 'Hello Wingman',
    welcomeMessage: 'Hi! How can I help you today?',
  },
});

await startServer({ config });
