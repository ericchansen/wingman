import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverMCPServers, discoverWithDiagnostics } from '../mcp.js';

// Mock fs/os modules to avoid real filesystem access in tests
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

describe('discoverMCPServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns built-in defaults when no other sources exist', async () => {
    const servers = await discoverMCPServers();
    expect(servers['powerbi-remote']).toBeDefined();
    expect(servers['powerbi-remote'].type).toBe('http');
    expect(servers['powerbi-remote'].url).toBe('https://api.fabric.microsoft.com/v1/mcp/powerbi');
  });

  it('merges user overrides on top of defaults', async () => {
    const servers = await discoverMCPServers({
      'my-server': {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        tools: ['*'],
      },
    });
    // Built-in still present
    expect(servers['powerbi-remote']).toBeDefined();
    // User override added
    expect(servers['my-server']).toBeDefined();
    expect(servers['my-server'].type).toBe('stdio');
  });

  it('user overrides replace built-in defaults with same name', async () => {
    const servers = await discoverMCPServers({
      'powerbi-remote': {
        type: 'http',
        url: 'https://custom.example.com/mcp',
        tools: ['*'],
      },
    });
    expect(servers['powerbi-remote'].url).toBe('https://custom.example.com/mcp');
  }, 15_000);
});

describe('discoverWithDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns diagnostics array with discovery header', async () => {
    const result = await discoverWithDiagnostics();
    expect(result.diagnostics[0]).toBe('🔌 MCP Servers Discovered:');
  });

  it('includes built-in server in sources map', async () => {
    const result = await discoverWithDiagnostics();
    expect(result.sources.get('powerbi-remote')).toBe('built-in');
  });

  it('marks user overrides as wingman.config.ts source', async () => {
    const result = await discoverWithDiagnostics({
      'custom-mcp': {
        type: 'stdio',
        command: 'python',
        args: ['-m', 'mcp'],
        tools: ['*'],
      },
    });
    expect(result.sources.get('custom-mcp')).toBe('wingman.config.ts');
  });

  it('returns empty skillDirectories when no plugins found', async () => {
    const result = await discoverWithDiagnostics();
    expect(result.skillDirectories).toEqual([]);
  });
});
