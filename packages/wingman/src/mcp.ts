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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { trace, SpanStatusCode, context, type Span } from '@opentelemetry/api';
import type { MCPServerConfig } from './types.js';
import { getValidToken, discoverAuthRequirements, type McpServerAuth } from './auth/index.js';

const execFileAsync = promisify(execFile);

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
      try {
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
            // External file reference (e.g., ".mcp.json")
            const externalPath = join(pluginPath, pluginJson.mcpServers);
            const external = await readJson<Record<string, unknown>>(externalPath);
            if (external) {
              // Handle both formats:
              // 1. Flat: { "server-name": { type, command, ... } }
              // 2. Wrapped: { "mcpServers": { "server-name": { type, command, ... } } }
              const unwrapped = (external.mcpServers && typeof external.mcpServers === 'object')
                ? external.mcpServers as Record<string, MCPServerConfig>
                : external as Record<string, MCPServerConfig>;
              pluginServers = unwrapped;
            }
          } else if (typeof pluginJson.mcpServers === 'object' && pluginJson.mcpServers !== null) {
            pluginServers = pluginJson.mcpServers;
          }

          for (const [name, config] of Object.entries(pluginServers)) {
            const cfg = config as unknown as Record<string, unknown>;
            // Set cwd for stdio servers so relative paths resolve from the plugin directory
            if (cfg.type === 'stdio' || cfg.type === 'local' || !cfg.type) {
              if (!cfg.cwd) {
                cfg.cwd = pluginPath;
              }
            }
            // Ensure tools field exists (SDK requires it)
            if (!config.tools) {
              config.tools = ['*'];
            }
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
      } catch (err) {
        diagnostics.push(`  ⚠️ ${catalog}/${plugin} — failed to load: ${err instanceof Error ? err.message : String(err)}`);
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
// Auth injection — Fabric/Power BI token for HTTP MCP servers
// ---------------------------------------------------------------------------

/** Cached Fabric token — refreshed when expired. */
let _fabricToken: { token: string; expiresOn: Date } | null = null;

/** Negative cache — avoid repeated 10s timeouts when az CLI is missing. */
let _fabricTokenFailedAt: number | null = null;
const NEGATIVE_CACHE_TTL_MS = 60_000; // 60 seconds

/** Track which HTTP servers need auth so the server layer can expose login routes. */
let _lastAuthStatus: McpServerAuth[] = [];

/**
 * Derive a user-friendly provider label from an OAuth authorization endpoint.
 * Groups servers that share the same identity provider under one label.
 */
function deriveProvider(authEndpoint: string | undefined): string | undefined {
  if (!authEndpoint) return undefined;
  try {
    const host = new URL(authEndpoint).hostname.toLowerCase();
    if (host.includes('login.microsoftonline.com') || host.includes('login.microsoft.com')) {
      return 'Microsoft';
    }
    if (host.includes('accounts.google.com')) return 'Google';
    if (host.includes('github.com')) return 'GitHub';
    // Return the domain as a fallback provider label
    return host.replace(/^(login|auth|accounts|id)\./i, '').replace(/\.(com|io|org|net)$/i, '');
  } catch {
    return undefined;
  }
}

/** Get the auth status from the most recent discovery run. */
export function getHttpServerAuthStatus(): McpServerAuth[] {
  return _lastAuthStatus;
}

/**
 * Update auth status for a single server after login/logout.
 * Called by the server after a successful OAuth flow completes.
 */
export async function refreshAuthStatusForServer(serverUrl: string): Promise<void> {
  const token = await getValidToken(serverUrl);
  _lastAuthStatus = _lastAuthStatus.map((s) => {
    if (s.serverUrl !== serverUrl) return s;
    // Don't change status of servers that don't need OAuth
    if (s.status === 'no_auth_required') return s;
    if (token) {
      return { ...s, status: 'authenticated' as const, expiresAt: token.expiresAt };
    }
    return { ...s, status: 'needs_auth' as const, expiresAt: undefined };
  });
}

/**
 * Try to read a Power BI token from the Copilot CLI's OAuth cache.
 *
 * The CLI caches tokens at `~/.copilot/mcp-oauth-config/*.tokens.json`.
 * We look for the file whose `scope` includes `analysis.windows.net/powerbi/api`
 * — that's the token with the correct audience and app registration
 * (appid `aebc6443-...`) that Power BI capacities authorize for DAX execution.
 *
 * The `az` CLI's own app (`04b07795-...`) gets a token with the right audience
 * but is not registered for DAX execution on most Power BI capacities.
 */
async function readCliCachedPowerBiToken(): Promise<string | null> {
  const cacheDir = join(homedir(), '.copilot', 'mcp-oauth-config');
  if (!(await exists(cacheDir))) return null;

  try {
    const files = await readdir(cacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.tokens.json'));

    for (const file of tokenFiles) {
      const content = await readJson<{ accessToken?: string; expiresAt?: number; scope?: string }>(join(cacheDir, file));
      if (!content?.accessToken || !content.scope) continue;

      // Match the Power BI-scoped token (not WorkIQ/M365 tokens)
      if (content.scope.includes('analysis.windows.net/powerbi/api')) {
        const expiresAt = content.expiresAt ? content.expiresAt * 1000 : 0;
        const bufferMs = 2 * 60 * 1000;
        if (expiresAt - Date.now() > bufferMs) {
          return content.accessToken;
        }
        // Token expired — skip, will fall through to az CLI
      }
    }
  } catch {
    // Cache dir unreadable — not fatal
  }
  return null;
}

/**
 * Acquire a Power BI token for the Fabric MCP API.
 *
 * Strategy (in order):
 * 1. In-process cache (fastest)
 * 2. Copilot CLI's OAuth cache (correct appid for DAX execution)
 * 3. `az account get-access-token` (fallback — metadata works, DAX may not)
 */
async function acquireFabricToken(): Promise<string | null> {
  if (_fabricToken) {
    const bufferMs = 2 * 60 * 1000;
    if (_fabricToken.expiresOn.getTime() - Date.now() > bufferMs) {
      return _fabricToken.token;
    }
    _fabricToken = null;
  }

  // Strategy 1: Read from Copilot CLI's OAuth cache (has correct appid for DAX)
  const cliToken = await readCliCachedPowerBiToken();
  if (cliToken) {
    // Decode expiry from JWT payload
    try {
      const payload = cliToken.split('.')[1];
      const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      const decoded = JSON.parse(Buffer.from(padded, 'base64url').toString());
      _fabricToken = { token: cliToken, expiresOn: new Date(decoded.exp * 1000) };
      return cliToken;
    } catch {
      // JWT decode failed — use token without caching expiry
      return cliToken;
    }
  }

  // Strategy 2: Fall back to az CLI (may lack DAX execution permissions)
  if (_fabricTokenFailedAt && Date.now() - _fabricTokenFailedAt < NEGATIVE_CACHE_TTL_MS) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      'az',
      ['account', 'get-access-token', '--resource', 'https://analysis.windows.net/powerbi/api', '--output', 'json'],
      { timeout: 10_000 },
    );
    const result = JSON.parse(stdout);
    if (result.accessToken) {
      _fabricToken = { token: result.accessToken, expiresOn: new Date(result.expiresOn) };
      _fabricTokenFailedAt = null;
      return result.accessToken;
    }
  } catch {
    _fabricTokenFailedAt = Date.now();
  }
  return null;
}

/**
 * Inject auth headers for HTTP MCP servers that need them.
 * Currently: Fabric API (*.fabric.microsoft.com) gets an Azure AD bearer token.
 * Uses URL hostname parsing to prevent token leakage to untrusted hosts.
 */
async function injectAuthHeaders(servers: Record<string, MCPServerConfig>): Promise<void> {
  const fabricServers = Object.values(servers).filter(
    (s): s is MCPServerConfig & { type: 'http'; url: string } => {
      if (s.type !== 'http' || !('url' in s) || typeof s.url !== 'string') return false;
      try {
        const hostname = new URL(s.url).hostname;
        return hostname === 'api.fabric.microsoft.com' || hostname.endsWith('.fabric.microsoft.com');
      } catch {
        return false;
      }
    },
  );

  if (fabricServers.length === 0) return;

  const token = await acquireFabricToken();
  if (!token) return;

  for (const server of fabricServers) {
    server.headers = { ...server.headers, Authorization: `Bearer ${token}` };
  }
}

/**
 * OAuth-based auth injection for HTTP MCP servers.
 *
 * For each HTTP server:
 * 1. Check token cache — if valid, inject and move on
 * 2. If no token, probe the server (RFC 9470) to discover if OAuth is required
 * 3. If the server returns 401 + resource_metadata → mark "needs_auth" with oauthConfig
 * 4. If the server does NOT require OAuth → mark "no_auth_required"
 *
 * This prevents false positives for servers like context7 or microsoft-learn
 * that use API keys or are public.
 */
async function injectOAuthHeaders(
  servers: Record<string, MCPServerConfig>,
  sources: Map<string, string>,
): Promise<void> {
  const authStatus: McpServerAuth[] = [];

  for (const [name, config] of Object.entries(servers)) {
    if (config.type !== 'http' || !('url' in config) || typeof config.url !== 'string') {
      continue;
    }

    try {
      // Step 1: Check if we already have a valid cached token
      const token = await getValidToken(config.url);
      if (token) {
        config.headers = { ...config.headers, Authorization: `Bearer ${token.accessToken}` };
        authStatus.push({
          serverUrl: config.url,
          serverName: name,
          status: 'authenticated',
          expiresAt: token.expiresAt,
        });
        console.log(`  🔑 ${name} — authenticated (token cached)`);
        continue;
      }

      // Step 2: No cached token — probe the server to see if it requires OAuth
      const oauthConfig = await discoverAuthRequirements(config.url);
      if (oauthConfig) {
        // Server requires OAuth and we don't have a token
        authStatus.push({
          serverUrl: config.url,
          serverName: name,
          status: 'needs_auth',
          oauthConfig,
          provider: deriveProvider(oauthConfig.authorizationEndpoint),
        });
        console.log(`  🔓 ${name} — needs sign-in (OAuth required)`);
      } else {
        // Server does NOT require OAuth (no 401, or no resource_metadata)
        authStatus.push({
          serverUrl: config.url,
          serverName: name,
          status: 'no_auth_required',
        });
        console.log(`  ✅ ${name} — no OAuth required`);
      }
    } catch (err) {
      authStatus.push({
        serverUrl: config.url,
        serverName: name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      console.warn(`  ⚠️ ${name} — auth check error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  _lastAuthStatus = authStatus;
}

// ---------------------------------------------------------------------------
// Server config validation
// ---------------------------------------------------------------------------

/**
 * Validate discovered MCP server configs. Skips invalid entries and logs
 * warnings for problems — prevents silent failures from malformed configs.
 */
function validateServers(
  servers: Record<string, MCPServerConfig>,
  diagnostics: string[],
): Record<string, MCPServerConfig> {
  const valid: Record<string, MCPServerConfig> = {};

  for (const [name, config] of Object.entries(servers)) {
    const cfg = config as unknown as Record<string, unknown>;

    // Skip wrapper objects (e.g., an entry named "mcpServers" that's actually a nested wrapper)
    if (cfg.mcpServers && typeof cfg.mcpServers === 'object') {
      diagnostics.push(`  ⚠️ ${name} — skipped (wrapper object, not a server config)`);
      continue;
    }

    // Validate type
    const serverType = cfg.type as string | undefined;
    if (!serverType) {
      cfg.type = 'stdio';
      diagnostics.push(`  ⚠️ ${name} — no type field, defaulting to stdio`);
    }

    // Validate command/url
    const resolvedType = (cfg.type as string) ?? 'stdio';
    if ((resolvedType === 'stdio' || resolvedType === 'local') && !cfg.command) {
      diagnostics.push(`  ❌ ${name} — stdio server missing 'command', skipping`);
      continue;
    }
    if ((resolvedType === 'http' || resolvedType === 'sse') && !cfg.url) {
      diagnostics.push(`  ❌ ${name} — HTTP server missing 'url', skipping`);
      continue;
    }

    // Default tools
    if (!config.tools || !Array.isArray(config.tools)) {
      config.tools = ['*'];
    }

    valid[name] = config;
  }

  return valid;
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
  fabricAuth: 'oauth' | 'cli' | 'inject' | 'none' = 'oauth',
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

  // Auth injection: add bearer tokens for HTTP servers that need them
  if (fabricAuth === 'inject') {
    await injectAuthHeaders(result);
  } else if (fabricAuth === 'oauth') {
    await injectOAuthHeaders(result, new Map());
  }

  // Validate — skip malformed entries
  return validateServers(result, []);
}

/**
 * Discover servers with full diagnostics — returns source tracking
 * and skill directories for logging and UI display.
 */
export async function discoverWithDiagnostics(
  userOverrides?: Record<string, MCPServerConfig>,
  projectRoot?: string,
  fabricAuth: 'oauth' | 'cli' | 'inject' | 'none' = 'oauth',
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

    // Auth injection: add bearer tokens for HTTP servers that need them
    if (fabricAuth === 'inject') {
      await injectAuthHeaders(servers);
    } else if (fabricAuth === 'oauth') {
      await injectOAuthHeaders(servers, sources);
    }

    // Validate — skip malformed entries, log warnings
    const validated = validateServers(servers, diagnostics);
    // Remove invalid servers from sources map too
    for (const name of Object.keys(servers)) {
      if (!(name in validated)) sources.delete(name);
    }
    Object.keys(servers).forEach((k) => { if (!(k in validated)) delete servers[k]; });
    Object.assign(servers, validated);

    discoverySpan.setAttribute('mcp.discovery.valid_servers', Object.keys(validated).length);
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
