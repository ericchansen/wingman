/**
 * Wingman Express Server — SSE streaming endpoint for the chat UI.
 *
 * Provides:
 * - POST /api/chat — SSE streaming chat endpoint
 * - GET /api/health — Health check
 * - Static file serving for the React frontend
 *
 * SSE is the Phase 0 transport. Socket.IO upgrade happens in Phase 2.
 */

import express from 'express';
import { resolve } from 'node:path';
import { WingmanClient } from './client.js';
import type { WingmanConfig } from './types.js';
import { resolveConfig } from './config.js';
import { discoverWithDiagnostics } from './mcp.js';
import { initTelemetry, shutdownTelemetry } from './instrumentation.js';

import type { Application, Request, Response } from 'express';
import type { Server } from 'node:http';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function validateSessionId(req: Request, res: Response): string | null {
  const { sessionId } = req.params;
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return null;
  }
  return sessionId;
}

const MAX_MESSAGE_LENGTH = 100_000;

export interface CreateServerOptions {
  config?: WingmanConfig;
  /** Absolute path to the built React frontend (dist/client). */
  staticDir?: string;
}

export interface ServerInstance {
  app: Application;
  client: WingmanClient;
  config: Required<WingmanConfig>;
}

export interface RunningServerInstance extends ServerInstance {
  server: Server;
}

export function createServer(options: CreateServerOptions = {}): ServerInstance {
  const config = resolveConfig(options.config ?? {});
  const client = new WingmanClient({ config });
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // CORS
  const corsOption = config.server.cors;
  if (corsOption) {
    // Warn when wildcard CORS is used in production
    if (corsOption === true && process.env.NODE_ENV === 'production') {
      console.warn(
        '[wingman] ⚠️  CORS is set to allow all origins (*). ' +
        'This is unsafe in production. Set server.cors to a specific ' +
        'origin or list of origins, e.g. cors: "https://myapp.com"',
      );
    }

    const allowedOrigins: Set<string> | null =
      typeof corsOption === 'string' ? new Set([corsOption])
      : Array.isArray(corsOption) ? new Set(corsOption)
      : null; // null ⇒ wildcard

    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (allowedOrigins) {
        if (origin && allowedOrigins.has(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // MCP discovery info
  app.get('/api/mcp', async (_req, res) => {
    try {
      const discovery = await discoverWithDiagnostics(config.mcpServers);
      res.json({
        servers: Object.keys(discovery.servers),
        sources: Object.fromEntries(discovery.sources),
        diagnostics: discovery.diagnostics,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // UI config (for React frontend)
  app.get('/api/config', (_req, res) => {
    res.json(config.ui);
  });

  // -------------------------------------------------------------------------
  // RPC routes — expose SDK controls for the UI
  // -------------------------------------------------------------------------

  // List available models
  app.get('/api/models', async (_req, res) => {
    try {
      const models = await client.listModels();
      res.json({ models });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Switch model for a session
  app.post('/api/session/:sessionId/model', async (req, res) => {
    const sessionId = validateSessionId(req, res);
    if (!sessionId) return;
    const { model } = req.body as { model?: string };

    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    try {
      await client.switchModel(sessionId, model);
      res.json({ ok: true, model });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('No session found') ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Get current mode for a session
  app.get('/api/session/:sessionId/mode', async (req, res) => {
    const sessionId = validateSessionId(req, res);
    if (!sessionId) return;

    try {
      const mode = await client.getMode(sessionId);
      res.json({ mode });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('No session found') ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Set mode for a session
  app.post('/api/session/:sessionId/mode', async (req, res) => {
    const sessionId = validateSessionId(req, res);
    if (!sessionId) return;
    const { mode } = req.body as { mode?: string };

    if (!mode || typeof mode !== 'string') {
      res.status(400).json({ error: 'mode is required' });
      return;
    }

    const allowedModes = ['interactive', 'plan', 'autopilot'] as const;
    if (!allowedModes.includes(mode as (typeof allowedModes)[number])) {
      res.status(400).json({ error: 'invalid mode', allowedModes });
      return;
    }

    try {
      await client.setMode(sessionId, mode as (typeof allowedModes)[number]);
      res.json({ ok: true, mode });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('No session found') ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Get account quota
  app.get('/api/quota', async (_req, res) => {
    try {
      const quota = await client.getQuota();
      res.json(quota ?? {});
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Chat SSE endpoint
  app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body as {
      message?: string;
      sessionId?: string;
    };

    // Input validation
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      return;
    }
    if (sessionId !== undefined && typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId must be a string' });
      return;
    }
    if (sessionId !== undefined && !SESSION_ID_PATTERN.test(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID format' });
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Disable Nagle's algorithm for immediate delivery
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    // SSE send helper
    const send = (event: string, data: Record<string, unknown>) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Request timeout: must exceed SDK's 300s so SDK error fires first
    const DEFAULT_TIMEOUT = 330_000;
    const parsed = parseInt(process.env.REQUEST_TIMEOUT ?? '', 10);
    const REQUEST_TIMEOUT = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT;
    const timeout = setTimeout(() => {
      if (!closed) {
        send('error', { message: 'Request timeout exceeded' });
        res.end();
      }
    }, REQUEST_TIMEOUT);

    // Keepalive pings to prevent browser/proxy timeout
    const keepalive = setInterval(() => {
      if (!closed) {
        res.write(`: keepalive\n\n`);
      }
    }, 5000);

    // Track client disconnection — registered after timers to avoid TDZ
    let closed = false;
    res.on('close', () => {
      closed = true;
      clearInterval(keepalive);
      clearTimeout(timeout);
    });

    // Send initial heartbeat
    send('heartbeat', { status: 'connected' });

    try {
      const resultSessionId = await client.sendMessage(
        sessionId,
        message.trim(),
        {
          onDelta: (content) => send('delta', { content }),
          onReasoningDelta: (content, reasoningId) =>
            send('reasoning_delta', { content, reasoningId }),
          onReasoning: (content, reasoningId) =>
            send('reasoning', { content, reasoningId }),
          onUsage: (usage) => send('usage', usage as unknown as Record<string, unknown>),
          onTurnStart: (turnId) => send('turn_start', { turnId }),
          onTurnEnd: (turnId) => send('turn_end', { turnId }),
          onIntent: (intent) => send('intent', { intent }),
          onToolStart: (tool) => send('tool_start', tool),
          onToolComplete: (toolCallId, toolName, result) =>
            send('tool_complete', { toolCallId, toolName, result }),
          onToolProgress: (toolCallId, message) =>
            send('tool_progress', { toolCallId, message }),
          onSkillInvoked: (name, pluginName) =>
            send('skill_invoked', { name, pluginName }),
          onSubagentStarted: (toolCallId, name, displayName) =>
            send('subagent_started', { toolCallId, name, displayName }),
          onSubagentCompleted: (toolCallId, name) =>
            send('subagent_completed', { toolCallId, name }),
          onSubagentFailed: (toolCallId, name, error) =>
            send('subagent_failed', { toolCallId, name, error }),
          onError: (message) => send('error', { message }),
          onInfo: (infoType, message) => send('info', { infoType, message }),
          onWarning: (warningType, message) =>
            send('warning', { warningType, message }),
          onModelChange: (model) => send('model_change', { model }),
          onTitleChanged: (title) => send('title_changed', { title }),
          onModeChanged: (mode) => send('mode_changed', { mode }),
          onTruncation: (data) => send('truncation', data),
          onCompactionStart: () => send('compaction_start', {}),
          onCompactionComplete: () => send('compaction_complete', {}),
        },
      );

      if (!closed) {
        send('done', { sessionId: resultSessionId });
        res.end();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!closed) {
        send('error', { message: errMsg });
        res.end();
      }
    } finally {
      clearInterval(keepalive);
      clearTimeout(timeout);
    }
  });

  // Serve static React frontend if staticDir provided
  if (options.staticDir) {
    app.use(express.static(resolve(options.staticDir)));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(resolve(options.staticDir!, 'index.html'));
    });
  }

  return { app, client, config };
}

/** Start the server and listen on the configured port. */
export async function startServer(options: CreateServerOptions = {}): Promise<RunningServerInstance> {
  // Initialize OTel before constructing app/client so the tracer provider
  // is registered before any trace.getTracer() calls
  const preConfig = resolveConfig(options.config ?? {});
  await initTelemetry(preConfig.telemetry);

  const { app, client, config } = createServer(options);
  const port = config.server.port;

  // Log MCP discovery
  const discovery = await discoverWithDiagnostics(config.mcpServers);
  for (const line of discovery.diagnostics) {
    console.log(line);
  }

  const server = app.listen(port, () => {
    console.log(`\n🦜 Wingman running at http://localhost:${port}\n`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    await client.stop();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, app, client, config };
}
