/**
 * WingmanClient — Core wrapper around the GitHub Copilot SDK's CopilotClient.
 *
 * Manages the CopilotClient singleton lifecycle, creates and resumes sessions,
 * and orchestrates MCP discovery, tools, and event routing.
 */

import { CopilotClient, approveAll, type SessionEvent, type MCPServerConfig as SDKMCPServerConfig } from '@github/copilot-sdk';
import type { WingmanConfig } from './types.js';
import { resolveConfig } from './config.js';
import { discoverMCPServers } from './mcp.js';
import { EventRouter, type EventCallbacks } from './events.js';

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

  constructor(options: WingmanClientOptions = {}) {
    this.config = resolveConfig(options.config ?? {});
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
      return cached.session;
    }

    // Build MCP server configurations
    const mcpServers = await this.buildMCPServers() as unknown as Record<string, SDKMCPServerConfig>;

    const sessionConfig = {
      model: this.config.model,
      streaming: true,
      systemMessage: { content: this.config.systemPrompt },
      mcpServers,
      skillDirectories: this.config.skillDirectories,
      onPermissionRequest: approveAll,
    };

    let session;
    if (sessionId) {
      session = await client.resumeSession(sessionId, sessionConfig);
    } else {
      session = await client.createSession(sessionConfig);
    }

    // Cache the session
    const sid = this.getSessionId(session);
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

    // Wire up event router
    const router = new EventRouter(callbacks);
    const unsubscribe = session.on((event: SessionEvent) => {
      router.route(event);
    });

    // Store unsubscribe for cleanup on next call
    if (cached) {
      cached.unsubscribe = unsubscribe;
    }

    const timeout = callbacks.timeout ?? 300_000;

    try {
      await session.sendAndWait({ prompt: message }, timeout);
    } finally {
      // Unsubscribe after this turn completes
      unsubscribe();
      if (cached) {
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

  /** Build MCP server configs from discovery + user config. */
  private async buildMCPServers() {
    return discoverMCPServers(this.config.mcpServers);
  }

  /** Gracefully shut down the client. */
  async stop() {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    sessionCache.clear();
  }

  /** Get the resolved configuration. */
  getConfig(): Required<WingmanConfig> {
    return this.config;
  }
}
