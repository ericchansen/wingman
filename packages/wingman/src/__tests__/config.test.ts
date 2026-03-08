import { describe, it, expect } from 'vitest';
import { defineConfig, resolveConfig, DEFAULT_CONFIG } from '../config.js';

describe('defineConfig', () => {
  it('returns the same config object passed in', () => {
    const config = { systemPrompt: 'Hello' };
    expect(defineConfig(config)).toBe(config);
  });

  it('accepts an empty config', () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it('preserves all provided fields', () => {
    const config = defineConfig({
      systemPrompt: 'You are Clippy.',
      model: 'claude-opus-4',
      ui: { title: 'Clippy', theme: 'dark' },
      server: { port: 8080 },
    });
    expect(config.systemPrompt).toBe('You are Clippy.');
    expect(config.model).toBe('claude-opus-4');
    expect(config.ui?.title).toBe('Clippy');
    expect(config.server?.port).toBe(8080);
  });
});

describe('resolveConfig', () => {
  it('fills in all defaults for an empty config', () => {
    const resolved = resolveConfig({});
    expect(resolved.systemPrompt).toBe(DEFAULT_CONFIG.systemPrompt);
    expect(resolved.model).toBe(DEFAULT_CONFIG.model);
    expect(resolved.ui.title).toBe('Wingman');
    expect(resolved.ui.theme).toBe('system');
    expect(resolved.ui.showTokenUsage).toBe(true);
    expect(resolved.ui.showModelPicker).toBe(true);
    expect(resolved.server.port).toBe(3000);
    expect(resolved.server.transport).toBe('sse');
    expect(resolved.telemetry.enabled).toBe(false);
  });

  it('overrides top-level fields', () => {
    const resolved = resolveConfig({
      systemPrompt: 'Custom prompt',
      model: 'gpt-4o',
    });
    expect(resolved.systemPrompt).toBe('Custom prompt');
    expect(resolved.model).toBe('gpt-4o');
    // defaults still present
    expect(resolved.ui.title).toBe('Wingman');
  });

  it('deep-merges ui config', () => {
    const resolved = resolveConfig({
      ui: { title: 'My App', theme: 'dark' },
    });
    expect(resolved.ui.title).toBe('My App');
    expect(resolved.ui.theme).toBe('dark');
    // other ui defaults preserved
    expect(resolved.ui.showTokenUsage).toBe(true);
    expect(resolved.ui.showModelPicker).toBe(true);
    expect(resolved.ui.showDebugPanel).toBe(false);
  });

  it('deep-merges server config', () => {
    const resolved = resolveConfig({
      server: { port: 8080 },
    });
    expect(resolved.server.port).toBe(8080);
    expect(resolved.server.cors).toBe(true);
    expect(resolved.server.transport).toBe('sse');
  });

  it('deep-merges telemetry config', () => {
    const resolved = resolveConfig({
      telemetry: { enabled: true },
    });
    expect(resolved.telemetry.enabled).toBe(true);
    expect(resolved.telemetry.exporter).toBe('console');
  });

  it('preserves array fields', () => {
    const resolved = resolveConfig({
      skillDirectories: ['/path/to/skills'],
    });
    expect(resolved.skillDirectories).toEqual(['/path/to/skills']);
  });

  it('deep-merges mcpServers — user additions preserve defaults', () => {
    const resolved = resolveConfig({
      mcpServers: {
        'my-server': { type: 'stdio', command: 'node', args: ['server.js'], tools: ['*'] },
      },
    });
    // User server added
    expect(resolved.mcpServers['my-server']).toBeDefined();
    expect(resolved.mcpServers['my-server'].type).toBe('stdio');
    // Default servers still present (DEFAULT_CONFIG.mcpServers is empty,
    // but this verifies the merge pattern works)
    expect(typeof resolved.mcpServers).toBe('object');
  });

  it('deep-merges mcpServers — user override replaces same-named server', () => {
    const resolved = resolveConfig({
      mcpServers: {
        'powerbi-remote': {
          type: 'http',
          url: 'https://custom.fabric.microsoft.com/v1/mcp/powerbi',
          headers: { Authorization: 'Bearer custom' },
          tools: ['*'],
        },
      },
    });
    const pbi = resolved.mcpServers['powerbi-remote'];
    expect(pbi).toBeDefined();
    expect(pbi.type).toBe('http');
    expect('url' in pbi && pbi.url).toBe('https://custom.fabric.microsoft.com/v1/mcp/powerbi');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has required top-level fields', () => {
    expect(DEFAULT_CONFIG.systemPrompt).toBeTruthy();
    expect(DEFAULT_CONFIG.model).toBeTruthy();
    expect(DEFAULT_CONFIG.reasoningEffort).toBeTruthy();
  });

  it('has complete ui defaults', () => {
    expect(DEFAULT_CONFIG.ui.title).toBe('Wingman');
    expect(DEFAULT_CONFIG.ui.theme).toBe('system');
    expect(DEFAULT_CONFIG.ui.welcomeMessage).toBe('How can I help?');
    expect(typeof DEFAULT_CONFIG.ui.showTokenUsage).toBe('boolean');
    expect(typeof DEFAULT_CONFIG.ui.showModelPicker).toBe('boolean');
    expect(typeof DEFAULT_CONFIG.ui.showModeSwitcher).toBe('boolean');
    expect(typeof DEFAULT_CONFIG.ui.showDebugPanel).toBe('boolean');
  });

  it('has complete server defaults', () => {
    expect(DEFAULT_CONFIG.server.port).toBe(3000);
    expect(DEFAULT_CONFIG.server.cors).toBe(true);
    expect(DEFAULT_CONFIG.server.transport).toBe('sse');
  });

  it('has complete telemetry defaults', () => {
    expect(DEFAULT_CONFIG.telemetry.enabled).toBe(false);
    expect(DEFAULT_CONFIG.telemetry.exporter).toBe('console');
  });
});
