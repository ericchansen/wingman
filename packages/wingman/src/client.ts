/**
 * WingmanClient — Core wrapper around the GitHub Copilot SDK's CopilotClient.
 *
 * Manages the CopilotClient singleton lifecycle, creates and resumes sessions,
 * and orchestrates MCP discovery, tools, and event routing.
 */

import { CopilotClient, approveAll, type SessionEvent, type MCPServerConfig as SDKMCPServerConfig } from '@github/copilot-sdk';
import type { WingmanConfig, AgentMode } from './types.js';
import { resolveConfig } from './config.js';
import { discoverWithDiagnostics } from './mcp.js';
import { EventRouter, type EventCallbacks } from './events.js';
import { createTracer } from './telemetry.js';

// ---------------------------------------------------------------------------
// Session cache — prevents duplicate events on resume
// ---------------------------------------------------------------------------

/**
 * The SDK's `resumeSession()` creates a new CopilotSession object that shares
 * the same backend session. Both objects receive events from the same JSON-RPC
 * connection, so listeners accumulate and events fire twice.
 *
 * Workaround: cache the original session object by ID and reuse it.
 */
const MAX_CACHED_SESSIONS = 20;
const sessionCache = new Map<string, {
  session: ReturnType<CopilotClient['createSession']> extends Promise<infer T> ? T : never;
  unsubscribe: (() => void) | null;
}>();

export interface SendMessageOptions extends Partial<EventCallbacks> {
  /** Timeout in milliseconds for sendAndWait. Default: 300_000 (5 min). */
  timeout?: number;
}

export interface WingmanClientOptions {
  config?: WingmanConfig;
}

export class WingmanClient {
  private client: CopilotClient | null = null;
  private config: Required<WingmanConfig>;
  private telemetry: ReturnType<typeof createTracer>;
  /** Original user-provided skill directories (immutable). */
  private readonly userSkillDirectories: string[];

  constructor(options: WingmanClientOptions = {}) {
    this.config = resolveConfig(options.config ?? {});
    this.userSkillDirectories = [...this.config.skillDirectories];
    this.telemetry = createTracer(this.config.telemetry);
  }

  /** Lazily initialize the CopilotClient singleton. */
  private getClient(): CopilotClient {
    if (!this.client) {
      this.client = new CopilotClient();
    }
    return this.client;
  }

  /**
   * Create or resume a session. If a sessionId is provided and a cached
   * session exists, reuses it to prevent listener duplication.
   */
  async getSession(sessionId?: string) {
    const client = this.getClient();

    // Resume from cache if possible
    if (sessionId && sessionCache.has(sessionId)) {
      const cached = sessionCache.get(sessionId)!;
      // Clean up previous listener before attaching a new one
      if (cached.unsubscribe) {
        cached.unsubscribe();
        cached.unsubscribe = null;
      }
      // Refresh LRU position: delete + re-set moves entry to end of Map iteration order
      sessionCache.delete(sessionId);
      sessionCache.set(sessionId, cached);
      return cached.session;
    }

    // Build MCP server configurations
    const mcpServers = await this.buildMCPServers() as unknown as Record<string, SDKMCPServerConfig>;

    const sessionConfig = {
      model: this.config.model,
      streaming: true,
      reasoningEffort: this.config.reasoningEffort,
      systemMessage: { content: this.config.systemPrompt },
      mcpServers,
      skillDirectories: this.config.skillDirectories,
      customAgents: this.config.customAgents,
      tools: this.config.tools,
      onPermissionRequest: approveAll,
    };

    // Session creation summary — confirms what the SDK will receive
    const serverNames = Object.keys(mcpServers);
    const serverSummary = serverNames.map((name) => {
      const cfg = mcpServers[name] as unknown as Record<string, unknown>;
      const type = (cfg.type as string) ?? 'stdio';
      const auth = cfg.headers ? '🔑' : '';
      return `${name}(${type}${auth})`;
    }).join(', ');
    console.log(`📋 Session: ${serverNames.length} MCP servers [${serverSummary}], ` +
      `${this.config.skillDirectories?.length ?? 0} skill dirs, ` +
      `${this.config.tools?.length ?? 0} tools`);

    let session;
    if (sessionId) {
      session = await client.resumeSession(sessionId, sessionConfig);
    } else {
      session = await client.createSession(sessionConfig);
    }

    // Cache the session, evicting oldest entries if at capacity
    const sid = this.getSessionId(session);
    if (sessionCache.size >= MAX_CACHED_SESSIONS && !sessionCache.has(sid)) {
      const oldest = sessionCache.keys().next().value;
      if (oldest) {
        const entry = sessionCache.get(oldest);
        entry?.unsubscribe?.();
        sessionCache.delete(oldest);
      }
    }
    sessionCache.set(sid, { session, unsubscribe: null });

    return session;
  }

  /**
   * Send a message and stream events to the provided callbacks.
   * Handles the full lifecycle: listener setup, sendAndWait, cleanup.
   */
  async sendMessage(
    sessionId: string | undefined,
    message: string,
    callbacks: SendMessageOptions = {},
  ) {
    const session = await this.getSession(sessionId);
    const sid = this.getSessionId(session);
    const cached = sessionCache.get(sid);

    // Clean up any previous listener
    if (cached?.unsubscribe) {
      cached.unsubscribe();
      cached.unsubscribe = null;
    }

    // Create telemetry callbacks for this turn
    const telemetryCallbacks = this.telemetry.createCallbacks(sid, this.config.model);

    // Compose user callbacks with telemetry callbacks
    const composedCallbacks = composeCallbacks(callbacks, telemetryCallbacks);

    // Wire up event router with composed callbacks
    const router = new EventRouter(composedCallbacks);
    const unsubscribe = session.on((event: SessionEvent) => {
      router.route(event);
    });

    // Track this specific unsubscribe by reference so the finally block
    // only cleans up its own listener, not a concurrent turn's listener.
    const myUnsubscribe = unsubscribe;
    if (cached) {
      cached.unsubscribe = unsubscribe;
    }

    // No practical timeout — skills like ACR reconciliation can run 10+ minutes
    const timeout = callbacks.timeout ?? 30 * 60_000; // 30 minutes

    try {
      await session.sendAndWait({ prompt: message }, timeout);
    } finally {
      // Only unsubscribe our own listener — if a concurrent turn replaced
      // cached.unsubscribe, we must not null it out.
      myUnsubscribe();
      if (cached && cached.unsubscribe === myUnsubscribe) {
        cached.unsubscribe = null;
      }
    }

    return sid;
  }

  /** Extract session ID from a session object. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getSessionId(session: any): string {
    return session.sessionId ?? session.id ?? 'unknown';
  }

  /** Build MCP server configs from discovery + user config, and populate skill directories. */
  private async buildMCPServers() {
    const result = await discoverWithDiagnostics(
      this.config.mcpServers,
      undefined,
      this.config.fabricAuth,
    );

    // Always recompute from (fresh discovery) + (original user dirs) — never accumulate stale paths
    this.config.skillDirectories = [...new Set([...result.skillDirectories, ...this.userSkillDirectories])];

    return result.servers;
  }

  /** Gracefully shut down the client. */
  async stop() {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    sessionCache.clear();
  }

  /**
   * Invalidate all cached sessions so the next getSession() call triggers
   * fresh MCP discovery with updated auth headers.
   *
   * Call this after auth changes (login/logout) to ensure new sessions
   * pick up the latest tokens.
   */
  invalidateSessions() {
    for (const [, cached] of sessionCache) {
      if (cached.unsubscribe) {
        cached.unsubscribe();
        cached.unsubscribe = null;
      }
    }
    sessionCache.clear();
    console.log('🔄 Session cache cleared — next message will re-discover MCP servers');
  }

  /** Get the resolved configuration. */
  getConfig(): Required<WingmanConfig> {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // RPC methods — expose SDK RPC surface for UI controls
  // -------------------------------------------------------------------------

  /** List available models from the SDK. */
  async listModels(): Promise<Array<{ id: string; name: string }>> {
    const client = this.getClient();
    const result = await client.rpc.models.list();
    return result.models.map((m) => ({
      id: m.id,
      name: m.id,
    }));
  }

  /** Switch the model for an active session. */
  async switchModel(sessionId: string, modelId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    await session.rpc.model.switchTo({ modelId });
  }

  /** Get the current agent mode for a session. */
  async getMode(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    const result = await session.rpc.mode.get();
    return result.mode;
  }

  /** Set the agent mode for a session. */
  async setMode(sessionId: string, mode: AgentMode): Promise<void> {
    const session = await this.getSession(sessionId);
    await session.rpc.mode.set({ mode });
  }

  /** Get account quota information. */
  async getQuota(): Promise<Record<string, unknown> | null> {
    const client = this.getClient();
    const result = await client.rpc.account.getQuota();
    const quotaSnapshots = result?.quotaSnapshots;
    return quotaSnapshots != null ? (quotaSnapshots as unknown as Record<string, unknown>) : null;
  }
}

// ---------------------------------------------------------------------------
// Callback composition — merges user + telemetry callbacks
// ---------------------------------------------------------------------------

/**
 * Compose two sets of EventCallbacks so both fire for each event.
 * Primary (user) callbacks fire first, then secondary (telemetry).
 * Telemetry callbacks are wrapped in try/catch — they must never
 * break user-facing streaming.
 */
function composeCallbacks(
  primary: Partial<EventCallbacks>,
  secondary: Partial<EventCallbacks>,
): EventCallbacks {
  const composed: Record<string, (...args: unknown[]) => void> = {};

  const allKeys = new Set([
    ...Object.keys(primary),
    ...Object.keys(secondary),
  ]);

  for (const key of allKeys) {
    const primaryValue = (primary as Record<string, unknown>)[key];
    const secondaryValue = (secondary as Record<string, unknown>)[key];

    const pFn = typeof primaryValue === 'function'
      ? (primaryValue as (...args: unknown[]) => void)
      : undefined;
    const sFn = typeof secondaryValue === 'function'
      ? (secondaryValue as (...args: unknown[]) => void)
      : undefined;

    if (pFn && sFn) {
      composed[key] = (...args: unknown[]) => {
        pFn(...args);
        try {
          sFn(...args);
        } catch (err) {
          console.debug('Telemetry callback error:', key, err);
        }
      };
    } else if (pFn) {
      composed[key] = pFn;
    } else if (sFn) {
      const wrappedSFn = sFn;
      composed[key] = (...args: unknown[]) => {
        try {
          wrappedSFn(...args);
        } catch (err) {
          console.debug('Telemetry callback error:', key, err);
        }
      };
    }
  }

  return composed as unknown as EventCallbacks;
}
