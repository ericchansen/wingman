/**
 * Tests for WingmanClient RPC methods and Express RPC routes.
 *
 * Tests the RPC method signatures, error handling, and server route
 * validation logic using mocked SDK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../server.js';
import express from 'express';

// ---------------------------------------------------------------------------
// Mock the SDK — we can't import the real one in tests (ESM issue)
// ---------------------------------------------------------------------------

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    rpc: {
      models: {
        list: vi.fn().mockResolvedValue({
          models: [
            { id: 'claude-sonnet-4', capabilities: { supports: {} } },
            { id: 'gpt-4o', capabilities: { supports: {} } },
          ],
        }),
      },
      account: {
        getQuota: vi.fn().mockResolvedValue({
          quotaSnapshots: {
            chat: { overageAllowedWithExhaustedQuota: false },
          },
        }),
      },
    },
    stop: vi.fn(),
  })),
  approveAll: vi.fn(),
}));

vi.mock('../mcp.js', () => ({
  discoverMCPServers: vi.fn().mockResolvedValue({}),
  discoverWithDiagnostics: vi.fn().mockResolvedValue({
    servers: {},
    sources: new Map(),
    skillDirectories: [],
    diagnostics: ['🔌 MCP Servers Discovered:'],
  }),
}));

// ---------------------------------------------------------------------------
// Helpers — lightweight supertest-like request helper
// ---------------------------------------------------------------------------

function createTestApp() {
  const { app, client, config } = createServer();
  return { app, client, config };
}

async function request(app: express.Application, method: 'get' | 'post', path: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const url = `http://localhost:${port}${path}`;

      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };
      if (body) options.body = JSON.stringify(body);

      fetch(url, options)
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          resolve({ status: 500, body: { error: String(err) } });
        });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RPC routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app } = createTestApp());
  });

  describe('GET /api/models', () => {
    it('returns list of available models', async () => {
      const res = await request(app, 'get', '/api/models');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('models');
      expect(Array.isArray((res.body as { models: unknown[] }).models)).toBe(true);
    });
  });

  describe('POST /api/session/:id/model', () => {
    it('returns 400 when model is missing', async () => {
      const res = await request(app, 'post', '/api/session/test-session/model', {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'model is required');
    });

    it('returns 400 when model is not a string', async () => {
      const res = await request(app, 'post', '/api/session/test-session/model', { model: 123 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/session/:id/mode', () => {
    it('returns error for non-existent session', async () => {
      const res = await request(app, 'get', '/api/session/nonexistent/mode');
      // Session doesn't exist — should be an error (404 or 500)
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/session/:id/mode', () => {
    it('returns 400 when mode is missing', async () => {
      const res = await request(app, 'post', '/api/session/test-session/mode', {});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'mode is required');
    });

    it('returns 400 for invalid mode', async () => {
      const res = await request(app, 'post', '/api/session/test-session/mode', { mode: 'turbo' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'invalid mode');
      expect(res.body).toHaveProperty('allowedModes');
    });

    it('accepts valid mode values', async () => {
      // This will fail at the session level (no real session), but validates input passes
      for (const mode of ['interactive', 'plan', 'autopilot']) {
        const res = await request(app, 'post', '/api/session/test-session/mode', { mode });
        // Should not be 400 — the input is valid, failure is at session layer
        expect(res.status).not.toBe(400);
      }
    });
  });

  describe('GET /api/quota', () => {
    it('returns quota information', async () => {
      const res = await request(app, 'get', '/api/quota');
      expect(res.status).toBe(200);
    });
  });
});
