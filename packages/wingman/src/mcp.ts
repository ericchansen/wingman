/**
 * MCP Discovery — Auto-discovers MCP servers from multiple sources.
 *
 * Discovery chain (later overrides earlier):
 * 1. Built-in defaults (Power BI remote)
 * 2. User global config (~/.copilot/mcp-config.json)
 * 3. Installed Copilot CLI plugins (~/.copilot/installed-plugins/)
 * 4. Project-level overrides (./mcp.json)
 * 5. User overrides from wingman.config.ts (highest priority)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { trace, SpanStatusCode, context, type Span } from '@opentelemetry/api';
import type { MCPServerConfig } from './types.js';

const MCP_TRACER = 'wingman';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  servers: Record<string, MCPServerConfig>;
  sources: Map<string, string>;
  skillDirectories: string[];
  diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Safe filesystem helpers
// ---------------------------------------------------------------------------

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discovery pipeline
// ---------------------------------------------------------------------------

/** Built-in default MCP servers. */
function getBuiltinDefaults(): Record<string, MCPServerConfig> {
  return {
    'powerbi-remote': {
      type: 'http',
      url: 'https://api.fabric.microsoft.com/v1/mcp/powerbi',
      tools: ['*'],
    },
  };
}

/** Load servers from ~/.copilot/mcp-config.json */
async function loadGlobalConfig(): Promise<Record<string, MCPServerConfig>> {
  const configPath = join(homedir(), '.copilot', 'mcp-config.json');
  const config = await readJson<{ mcpServers?: Record<string, MCPServerConfig> }>(configPath);
  return config?.mcpServers ?? {};
}

/** Scan installed plugins for MCP server configs. */
async function loadPluginServers(): Promise<{
  servers: Record<string, MCPServerConfig>;
  skills: string[];
  diagnostics: string[];
}> {
  const servers: Record<string, MCPServerConfig> = {};
  const skills: string[] = [];
  const diagnostics: string[] = [];

  const pluginsBase = join(homedir(), '.copilot', 'installed-plugins');
  if (!(await exists(pluginsBase))) {
    return { servers, skills, diagnostics };
  }

  // Scan catalog directories (_direct, copilot-plugins, awesome-copilot)
  const catalogs = await readdir(pluginsBase).catch(() => []);

  for (const catalog of catalogs) {
    const catalogPath = join(pluginsBase, catalog);
    const catalogStat = await stat(catalogPath).catch(() => null);
    if (!catalogStat?.isDirectory()) continue;

    const plugins = await readdir(catalogPath).catch(() => []);

    for (const plugin of plugins) {
      const pluginPath = join(catalogPath, plugin);
      const pluginJsonPath = join(pluginPath, 'plugin.json');

      const pluginJson = await readJson<{
        mcpServers?: Record<string, MCPServerConfig> | string;
        skills?: string;
        agents?: string;
      }>(pluginJsonPath);

      if (!pluginJson) continue;

      // MCP servers — can be inline object or path to external JSON
      if (pluginJson.mcpServers) {
        let pluginServers: Record<string, MCPServerConfig> = {};

        if (typeof pluginJson.mcpServers === 'string') {
          // External file reference
          const externalPath = join(pluginPath, pluginJson.mcpServers);
          const external = await readJson<Record<string, MCPServerConfig>>(externalPath);
          if (external) pluginServers = external;
        } else {
          pluginServers = pluginJson.mcpServers;
        }

        for (const [name, config] of Object.entries(pluginServers)) {
          servers[name] = config;
          diagnostics.push(`  ✅ ${name} ← plugin (${catalog}/${plugin})`);
        }
      }

      // Skills directory
      if (pluginJson.skills) {
        const skillsDir = join(pluginPath, pluginJson.skills);
        if (await exists(skillsDir)) {
          skills.push(skillsDir);
        }
      }
    }
  }

  return { servers, skills, diagnostics };
}

/** Load project-level MCP config from ./mcp.json */
async function loadProjectConfig(projectRoot?: string): Promise<Record<string, MCPServerConfig>> {
  const root = projectRoot ?? process.cwd();
  const mcpJsonPath = join(root, 'mcp.json');
  const config = await readJson<{ mcpServers?: Record<string, MCPServerConfig> }>(mcpJsonPath);
  return config?.mcpServers ?? {};
}

// ---------------------------------------------------------------------------
// OTel discovery helper
// ---------------------------------------------------------------------------

type OTelTracer = ReturnType<typeof trace.getTracer>;
type OTelContext = ReturnType<typeof context.active>;

async function runDiscoveryStage(
  tracer: OTelTracer,
  parentCtx: OTelContext,
  spanName: string,
  fn: (stageSpan: Span) => Promise<void>,
): Promise<void> {
  const span = tracer.startSpan(spanName, {}, parentCtx);
  try {
    await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all MCP servers from the 5-stage pipeline.
 * User-provided overrides (from wingman.config.ts) are merged last.
 */
export async function discoverMCPServers(
  userOverrides?: Record<string, MCPServerConfig>,
): Promise<Record<string, MCPServerConfig>> {
  const result: Record<string, MCPServerConfig> = {};

  // Stage 1: Built-in defaults
  Object.assign(result, getBuiltinDefaults());

  // Stage 2: Global config
  Object.assign(result, await loadGlobalConfig());

  // Stage 3: Plugins
  const plugins = await loadPluginServers();
  Object.assign(result, plugins.servers);

  // Stage 4: Project config
  Object.assign(result, await loadProjectConfig());

  // Stage 5: User overrides from wingman.config.ts
  if (userOverrides) {
    Object.assign(result, userOverrides);
  }

  return result;
}

/**
 * Discover servers with full diagnostics — returns source tracking
 * and skill directories for logging and UI display.
 */
export async function discoverWithDiagnostics(
  userOverrides?: Record<string, MCPServerConfig>,
  projectRoot?: string,
): Promise<DiscoveryResult> {
  const tracer = trace.getTracer(MCP_TRACER);
  const discoverySpan = tracer.startSpan('mcp.discovery', {
    attributes: {
      'mcp.discovery.has_overrides': userOverrides != null && Object.keys(userOverrides).length > 0,
    },
  });
  const ctx = trace.setSpan(context.active(), discoverySpan);

  const servers: Record<string, MCPServerConfig> = {};
  const sources = new Map<string, string>();
  const diagnostics: string[] = ['🔌 MCP Servers Discovered:'];
  const skillDirectories: string[] = [];

  try {
    // Stage 1: Built-in defaults
    await runDiscoveryStage(tracer, ctx, 'mcp.discovery.stage1_builtins', async (stageSpan) => {
      const builtins = getBuiltinDefaults();
      for (const [name, config] of Object.entries(builtins)) {
        servers[name] = config;
        sources.set(name, 'built-in');
        diagnostics.push(`  ✅ ${name} ← built-in default`);
      }
      stageSpan.setAttribute('mcp.discovery.stage1.count', Object.keys(builtins).length);
    });

    // Stage 2: Global config
    await runDiscoveryStage(tracer, ctx, 'mcp.discovery.stage2_global', async (stageSpan) => {
      const globals = await loadGlobalConfig();
      for (const [name, config] of Object.entries(globals)) {
        servers[name] = config;
        sources.set(name, 'global config');
        diagnostics.push(`  ✅ ${name} ← global config`);
      }
      stageSpan.setAttribute('mcp.discovery.stage2.count', Object.keys(globals).length);
    });

    // Stage 3: Plugins
    await runDiscoveryStage(tracer, ctx, 'mcp.discovery.stage3_plugins', async (stageSpan) => {
      const plugins = await loadPluginServers();
      for (const [name, config] of Object.entries(plugins.servers)) {
        servers[name] = config;
        sources.set(name, 'plugin');
      }
      diagnostics.push(...plugins.diagnostics);
      skillDirectories.push(...plugins.skills);
      stageSpan.setAttribute('mcp.discovery.stage3.count', Object.keys(plugins.servers).length);
    });

    // Stage 4: Project config
    await runDiscoveryStage(tracer, ctx, 'mcp.discovery.stage4_project', async (stageSpan) => {
      const project = await loadProjectConfig(projectRoot);
      for (const [name, config] of Object.entries(project)) {
        servers[name] = config;
        sources.set(name, 'project mcp.json');
        diagnostics.push(`  ✅ ${name} ← project mcp.json`);
      }
      stageSpan.setAttribute('mcp.discovery.stage4.count', Object.keys(project).length);
    });

    // Stage 5: User overrides
    if (userOverrides && Object.keys(userOverrides).length > 0) {
      await runDiscoveryStage(tracer, ctx, 'mcp.discovery.stage5_overrides', async (stageSpan) => {
        for (const [name, config] of Object.entries(userOverrides)) {
          servers[name] = config;
          sources.set(name, 'wingman.config.ts');
          diagnostics.push(`  ✅ ${name} ← wingman.config.ts`);
        }
        stageSpan.setAttribute('mcp.discovery.stage5.count', Object.keys(userOverrides).length);
      });
    }

    discoverySpan.setAttribute('mcp.discovery.total_servers', Object.keys(servers).length);
    discoverySpan.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    discoverySpan.recordException(error as Error);
    discoverySpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    discoverySpan.end();
  }

  return { servers, sources, skillDirectories, diagnostics };
}
