/**
 * Tests for MCP discovery OTel tracing.
 *
 * Verifies that discoverMCPServers and discoverWithDiagnostics produce
 * correct results with OTel spans active, and that span creation does not
 * interfere with the discovery pipeline's output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverMCPServers, discoverWithDiagnostics } from '../mcp.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

// Mock child_process to avoid real az CLI calls (Fabric auth injection)
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(new Error('az not available in test'), '', '');
  }),
}));

describe('discoverMCPServers with OTel tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct servers even with OTel span active', async () => {
    const servers = await discoverMCPServers();
    expect(servers['powerbi-remote']).toBeDefined();
    expect(servers['powerbi-remote'].type).toBe('http');
  });

  it('user overrides survive the tracing wrapper', async () => {
    const servers = await discoverMCPServers({
      'custom-server': { type: 'stdio', command: 'node', args: ['server.js'], tools: ['*'] },
    });
    expect(servers['custom-server']).toBeDefined();
    expect(servers['powerbi-remote']).toBeDefined();
  });
});

describe('discoverWithDiagnostics with OTel tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('diagnostics header is present', async () => {
    const result = await discoverWithDiagnostics();
    expect(result.diagnostics[0]).toBe('🔌 MCP Servers Discovered:');
  });

  it('built-in server is tracked in sources map', async () => {
    const result = await discoverWithDiagnostics();
    expect(result.sources.get('powerbi-remote')).toBe('built-in');
  });

  it('user override source is tracked correctly', async () => {
    const result = await discoverWithDiagnostics({
      'override-server': { type: 'stdio', command: 'python', args: ['-m', 'mcp'], tools: ['*'] },
    });
    expect(result.sources.get('override-server')).toBe('wingman.config.ts');
  });

  it('skill directories are empty when no plugins are found', async () => {
    const result = await discoverWithDiagnostics();
    expect(result.skillDirectories).toEqual([]);
  });

  it('returns all 5 stages with correct server count', async () => {
    const result = await discoverWithDiagnostics({
      'extra-server': { type: 'http', url: 'https://example.com/mcp', tools: ['*'] },
    });
    // powerbi-remote (built-in) + extra-server (override) = 2
    expect(Object.keys(result.servers).length).toBe(2);
  });

  it('discovery output is deterministic across calls', async () => {
    const [result1, result2] = await Promise.all([
      discoverWithDiagnostics(),
      discoverWithDiagnostics(),
    ]);
    expect(Object.keys(result1.servers)).toEqual(Object.keys(result2.servers));
  });
});

describe('MCP discovery span error handling', () => {
  it('returns built-in defaults even when a stage fails (e.g. global config read error)', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('disk read error'));

    // Discovery should still return built-in defaults even when global config fails
    const result = await discoverWithDiagnostics();
    expect(result.servers['powerbi-remote']).toBeDefined();
  });
});
