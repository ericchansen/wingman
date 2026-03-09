/**
 * OAuth Service — standalone OAuth 2.0 Authorization Code + PKCE flow
 * for remote HTTP MCP servers.
 *
 * Flow:
 * 1. Probe MCP server → 401 + WWW-Authenticate → resource metadata URL
 * 2. Fetch resource metadata (RFC 9470) → authorization server, scopes
 * 3. Fetch authorization server OIDC config → authorize + token endpoints
 * 4. Open browser to authorize endpoint (with PKCE)
 * 5. Handle callback on ephemeral loopback server → exchange code for tokens
 * 6. Cache tokens → inject into MCP headers
 */

import { createServer as createHttpServer, type Server } from 'node:http';
import { URL, URLSearchParams } from 'node:url';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { loadToken, saveToken, removeToken, isExpired, type StoredToken } from './token-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResourceMetadata {
  issuer: string;
  authorization_servers: string[];
  resource: string;
  scopes_supported: string[];
}

export interface AuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  issuer: string;
}

export interface OAuthFlowState {
  serverUrl: string;
  codeVerifier: string;
  state: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  tokenEndpoint: string;
}

export interface OAuthServerConfig {
  serverUrl: string;
  clientId: string;
  scope: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface McpServerAuth {
  serverUrl: string;
  serverName: string;
  status: 'authenticated' | 'needs_auth' | 'no_auth_required' | 'error';
  expiresAt?: number;
  error?: string;
  oauthConfig?: OAuthServerConfig | null;
}

// ---------------------------------------------------------------------------
// In-flight flow tracking
// ---------------------------------------------------------------------------

const pendingFlows = new Map<string, {
  flow: OAuthFlowState;
  resolve: (token: StoredToken) => void;
  reject: (err: Error) => void;
}>();

let callbackServer: Server | null = null;
let callbackPort = 0;
const flowPromises = new Map<string, Promise<StoredToken>>();

// ---------------------------------------------------------------------------
// Discovery — probe MCP servers for auth requirements (RFC 9470)
// ---------------------------------------------------------------------------

export async function discoverAuthRequirements(serverUrl: string): Promise<OAuthServerConfig | null> {
  const PROBE_TIMEOUT = 10_000; // 10s timeout for all discovery fetches

  // Step 1: Hit the server without auth
  let resourceMetadataUrl: string;
  try {
    const response = await fetch(serverUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
    if (response.status !== 401) return null;

    const wwwAuth = response.headers.get('www-authenticate') ?? '';
    const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
    if (!match) {
      console.warn(`[wingman:oauth] ${serverUrl} returned 401 but no resource_metadata in WWW-Authenticate`);
      return null;
    }
    resourceMetadataUrl = match[1];

    // Validate metadata URL — must be HTTPS to prevent SSRF
    try {
      const metaUrl = new URL(resourceMetadataUrl);
      if (metaUrl.protocol !== 'https:') {
        console.warn(`[wingman:oauth] Rejecting non-HTTPS resource_metadata URL: ${resourceMetadataUrl}`);
        return null;
      }
    } catch {
      console.warn(`[wingman:oauth] Invalid resource_metadata URL: ${resourceMetadataUrl}`);
      return null;
    }
  } catch (err) {
    console.warn(`[wingman:oauth] Failed to probe ${serverUrl}:`, err instanceof Error ? err.message : String(err));
    return null;
  }

  // Step 2: Fetch resource metadata (RFC 9470)
  let resourceMeta: ResourceMetadata;
  try {
    const res = await fetch(resourceMetadataUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    if (!res.ok) return null;
    resourceMeta = await res.json() as ResourceMetadata;
  } catch (err) {
    console.warn(`[wingman:oauth] Failed to fetch resource metadata:`, err instanceof Error ? err.message : String(err));
    return null;
  }

  if (!resourceMeta.authorization_servers?.length) return null;

  // Step 3: Fetch authorization server OIDC config
  const authServerUrl = resourceMeta.authorization_servers[0];
  let authMeta: AuthServerMetadata;
  try {
    const res = await fetch(`${authServerUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    if (!res.ok) return null;
    authMeta = await res.json() as AuthServerMetadata;
  } catch (err) {
    console.warn(`[wingman:oauth] Failed to fetch auth server metadata:`, err instanceof Error ? err.message : String(err));
    return null;
  }

  // Step 4: Use the same client_id the Copilot CLI uses.
  // This is GitHub's registered public OAuth app for Copilot, pre-authorized
  // for Power BI DAX execution. Verified via device code flow probe.
  const clientId = 'aebc6443-996d-45c2-90f0-388ff96faa56';

  const scope = resourceMeta.scopes_supported?.length
    ? `${resourceMeta.scopes_supported.join(' ')} offline_access`
    : 'https://analysis.windows.net/powerbi/api/.default offline_access';

  return {
    serverUrl,
    clientId,
    scope,
    authorizationEndpoint: authMeta.authorization_endpoint,
    tokenEndpoint: authMeta.token_endpoint,
  };
}

// ---------------------------------------------------------------------------
// Callback server — ephemeral loopback (RFC 8252 §7.3)
// ---------------------------------------------------------------------------

async function ensureCallbackServer(): Promise<string> {
  if (callbackServer?.listening) {
    // Entra ID requires http://localhost (not 127.0.0.1) for dynamic port native apps
    return `http://localhost:${callbackPort}/`;
  }

  return new Promise((resolve, reject) => {
    const server = createHttpServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${callbackPort}`);

      // Only handle the root path (where Entra ID sends the callback)
      if (url.pathname !== '/') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDesc = url.searchParams.get('error_description');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(resultHtml(false, errorDesc ?? error));
        const pending = state ? pendingFlows.get(state) : null;
        if (pending) {
          pending.reject(new Error(`OAuth error: ${error} — ${errorDesc}`));
          pendingFlows.delete(state!);
        }
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(resultHtml(false, 'Missing code or state parameter.'));
        return;
      }

      const pending = pendingFlows.get(state);
      if (!pending) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(resultHtml(false, 'No pending authentication flow matches this callback.'));
        return;
      }

      exchangeCodeForTokens(code, pending.flow)
        .then((token) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(resultHtml(true, ''));
          pending.resolve(token);
          pendingFlows.delete(state);
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(resultHtml(false, err instanceof Error ? err.message : String(err)));
          pending.reject(err instanceof Error ? err : new Error(String(err)));
          pendingFlows.delete(state);
        });
    });

    // Listen on 127.0.0.1 (localhost resolves here), but use http://localhost in redirect_uri
    // Entra ID treats localhost specially: dynamic ports are allowed for native public clients
    // 127.0.0.1 is NOT equivalent — it requires explicit registration (RFC 8252 §7.3 + MS docs)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start callback server'));
        return;
      }
      callbackPort = addr.port;
      callbackServer = server;
      console.log(`[wingman:oauth] Callback server on http://localhost:${callbackPort}`);
      resolve(`http://localhost:${callbackPort}/`);
    });
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Token exchange + refresh
// ---------------------------------------------------------------------------

async function exchangeCodeForTokens(code: string, flow: OAuthFlowState): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: flow.clientId,
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.codeVerifier,
    scope: flow.scope,
  });

  const response = await fetch(flow.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errBody}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  const token: StoredToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    scope: data.scope ?? flow.scope,
    serverUrl: flow.serverUrl,
    clientId: flow.clientId,
    storedAt: Math.floor(Date.now() / 1000),
  };

  await saveToken(token);
  console.log(`[wingman:oauth] Token acquired for ${flow.serverUrl} (expires in ${data.expires_in}s)`);
  return token;
}

export async function refreshToken(serverUrl: string): Promise<StoredToken | null> {
  const existing = await loadToken(serverUrl);
  if (!existing?.refreshToken) return null;

  const config = await discoverAuthRequirements(serverUrl);
  if (!config) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: existing.clientId,
    refresh_token: existing.refreshToken,
    scope: existing.scope,
  });

  try {
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      console.warn(`[wingman:oauth] Token refresh failed for ${serverUrl} (${response.status})`);
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    const token: StoredToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? existing.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      scope: data.scope ?? existing.scope,
      serverUrl,
      clientId: existing.clientId,
      storedAt: Math.floor(Date.now() / 1000),
    };

    await saveToken(token);
    console.log(`[wingman:oauth] Token refreshed for ${serverUrl} (expires in ${data.expires_in}s)`);
    return token;
  } catch (err) {
    console.warn(`[wingman:oauth] Token refresh error:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a valid token for a server (cached or refreshed). Null = needs browser login. */
export async function getValidToken(serverUrl: string): Promise<StoredToken | null> {
  const token = await loadToken(serverUrl);
  if (!token) return null;
  if (!isExpired(token)) return token;
  if (token.refreshToken) {
    const refreshed = await refreshToken(serverUrl);
    if (refreshed) return refreshed;
  }
  return null;
}

/** Start an interactive OAuth flow. Returns the auth URL to open in a browser. */
export async function startAuthFlow(serverUrl: string): Promise<{ authUrl: string; state: string }> {
  const config = await discoverAuthRequirements(serverUrl);
  if (!config) throw new Error(`Could not discover auth requirements for ${serverUrl}`);

  const redirectUri = await ensureCallbackServer();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const flow: OAuthFlowState = {
    serverUrl,
    codeVerifier,
    state,
    clientId: config.clientId,
    scope: config.scope,
    redirectUri,
    tokenEndpoint: config.tokenEndpoint,
  };

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: config.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  const authUrl = `${config.authorizationEndpoint}?${params.toString()}`;

  const resultPromise = new Promise<StoredToken>((resolve, reject) => {
    pendingFlows.set(state, { flow, resolve, reject });
    setTimeout(() => {
      if (pendingFlows.has(state)) {
        pendingFlows.delete(state);
        reject(new Error('OAuth flow timed out (5 minutes)'));
      }
    }, 5 * 60 * 1000);
  });

  flowPromises.set(state, resultPromise);
  return { authUrl, state };
}

/** Wait for a pending OAuth flow to complete. */
export async function waitForCallback(state: string): Promise<StoredToken> {
  const promise = flowPromises.get(state);
  if (!promise) throw new Error(`No pending OAuth flow with state: ${state}`);
  try {
    return await promise;
  } finally {
    flowPromises.delete(state);
  }
}

export function getPendingFlows(): string[] {
  return Array.from(pendingFlows.keys());
}

export async function logout(serverUrl: string): Promise<void> {
  await removeToken(serverUrl);
}

export function shutdownCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
    callbackPort = 0;
  }
}

// ---------------------------------------------------------------------------
// HTML response for the browser callback tab
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resultHtml(success: boolean, detail: string): string {
  const icon = success ? '✅' : '❌';
  const title = success ? "You're signed in!" : 'Authentication Failed';
  const sub = success
    ? 'You can close this tab and return to your app.'
    : escapeHtml(detail);
  const color = success ? '#3fb950' : '#f85149';
  return `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; align-items: center; justify-content: center; height: 100vh;
    margin: 0; background: #0d1117; color: #e6edf3; }
  .card { text-align: center; padding: 2rem; max-width: 500px; }
  .icon { font-size: 4rem; margin-bottom: 1rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; color: ${color}; }
  p { color: #8b949e; margin: 0; word-break: break-word; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${sub}</p>
</div></body></html>`;
}
