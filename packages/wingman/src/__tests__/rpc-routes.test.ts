/**
 * Tests for WingmanClient RPC methods and Express RPC routes.
 *
 * Tests the RPC method signatures, error handling, and server route
 * validation logic using mocked SDK and supertest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../server.js';
import supertest from 'supertest';

// ---------------------------------------------------------------------------
// Mock the SDK — we can't import the real one in tests (ESM issue)
// ---------------------------------------------------------------------------

const mockModeGet = vi.fn().mockResolvedValue({ mode: 'interactive' });
const mockModeSet = vi.fn().mockResolvedValue({ mode: 'plan' });
const mockModelSwitchTo = vi.fn().mockResolvedValue({ modelId: 'gpt-4o' });
const mockModelGetCurrent = vi.fn().mockResolvedValue({ modelId: 'claude-sonnet-4' });

const mockCreateSession = vi.fn().mockResolvedValue({
  sessionId: 'test-session-123',
  rpc: {
    mode: { get: mockModeGet, set: mockModeSet },
    model: { switchTo: mockModelSwitchTo, getCurrent: mockModelGetCurrent },
  },
  on: vi.fn().mockReturnValue(vi.fn()),
});

const mockResumeSession = vi.fn().mockResolvedValue({
  sessionId: 'test-session-123',
  rpc: {
    mode: { get: mockModeGet, set: mockModeSet },
    model: { switchTo: mockModelSwitchTo, getCurrent: mockModelGetCurrent },
  },
  on: vi.fn().mockReturnValue(vi.fn()),
});

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
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
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
// Tests
// ---------------------------------------------------------------------------

describe('RPC routes', () => {
  let agent: ReturnType<typeof supertest>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { app, client } = createServer();
    agent = supertest(app);
    // Pre-populate session cache by creating a session via the client
    await client.getSession();
  });

  describe('GET /api/models', () => {
    it('returns list of available models', async () => {
      const res = await agent.get('/api/models');
      expect(res.status).toBe(200);
      expect(res.body.models).toEqual([
        { id: 'claude-sonnet-4', name: 'claude-sonnet-4' },
        { id: 'gpt-4o', name: 'gpt-4o' },
      ]);
    });
  });

  describe('POST /api/session/:id/model', () => {
    it('returns 400 when model is missing', async () => {
      const res = await agent.post('/api/session/test-session-123/model').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('model is required');
    });

    it('returns 400 when model is not a string', async () => {
      const res = await agent.post('/api/session/test-session-123/model').send({ model: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('model is required');
    });

    it('switches model for a valid session', async () => {
      const res = await agent.post('/api/session/test-session-123/model').send({ model: 'gpt-4o' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, model: 'gpt-4o' });
      expect(mockModelSwitchTo).toHaveBeenCalledWith({ modelId: 'gpt-4o' });
    });
  });

  describe('GET /api/session/:id/mode', () => {
    it('returns current mode for a valid session', async () => {
      const res = await agent.get('/api/session/test-session-123/mode');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'interactive' });
      expect(mockModeGet).toHaveBeenCalled();
    });
  });

  describe('POST /api/session/:id/mode', () => {
    it('returns 400 when mode is missing', async () => {
      const res = await agent.post('/api/session/test-session-123/mode').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('mode is required');
    });

    it('returns 400 for invalid mode value', async () => {
      const res = await agent.post('/api/session/test-session-123/mode').send({ mode: 'turbo' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid mode');
      expect(res.body.allowedModes).toEqual(['interactive', 'plan', 'autopilot']);
    });

    it('sets mode for a valid session with valid mode', async () => {
      const res = await agent.post('/api/session/test-session-123/mode').send({ mode: 'plan' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, mode: 'plan' });
      expect(mockModeSet).toHaveBeenCalledWith({ mode: 'plan' });
    });

    it('accepts all three valid modes', async () => {
      for (const mode of ['interactive', 'plan', 'autopilot']) {
        const res = await agent.post('/api/session/test-session-123/mode').send({ mode });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
      }
    });
  });

  describe('GET /api/quota', () => {
    it('returns quota snapshots', async () => {
      const res = await agent.get('/api/quota');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('chat');
    });
  });
});
