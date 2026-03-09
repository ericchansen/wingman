# MCP Server Authentication

Wingman automatically handles authentication for remote MCP servers that require OAuth tokens. This document explains how auth works, how to configure it, and how to debug token issues.

## How It Works

When Wingman discovers HTTP-based MCP servers (like Power BI at `api.fabric.microsoft.com`), it needs to attach an `Authorization: Bearer <token>` header for the server to accept connections. Without a valid token, the MCP server won't complete the handshake and no tools will be discovered.

### Token Acquisition Strategy

Wingman uses a **four-tier fallback** to acquire tokens for Fabric/Power BI MCP servers:

```
┌─────────────────────────────┐
│ 1. In-process cache         │  ← Fastest (sub-millisecond)
│    Cached from prior call   │
└────────────┬────────────────┘
             │ expired/miss
┌────────────▼────────────────┐
│ 2. Wingman OAuth module     │  ← DEFAULT — standalone browser OAuth
│    ~/.wingman/tokens/       │     RFC 9470 discovery, PKCE flow
│    {hash}.json              │     Full DAX + browser UI support
└────────────┬────────────────┘
             │ no cached token / not configured
┌────────────▼────────────────┐
│ 3. Copilot CLI OAuth cache  │  ← Fallback (correct appid + scopes)
│    ~/.copilot/mcp-oauth-    │     Requires prior `copilot` session
│    config/*.tokens.json     │
└────────────┬────────────────┘
             │ not found/expired
┌────────────▼────────────────┐
│ 4. Azure CLI fallback       │  ← Metadata-only (schema/discover work,
│    az account get-access-   │     DAX execution may fail)
│    token                    │
└─────────────────────────────┘
```

**Why the Wingman OAuth module is the default:** It runs a standalone OAuth flow directly from your app — no dependency on the Copilot CLI or Azure CLI. The browser-based Authorization Code + PKCE flow produces tokens with the correct audience and app registration for full Power BI operations including DAX query execution. It also exposes `/api/auth/*` routes so a browser UI can trigger and monitor login.

**Copilot CLI cache as fallback:** The CLI uses OAuth app `aebc6443-996d-45c2-90f0-388ff96faa56` with browser-based login. This app registration is also authorized for full Power BI operations. The Azure CLI app (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) can authenticate but is typically not authorized for DAX execution — it only gets metadata-level access.

### The Two-Token Problem (Power BI)

Power BI's Fabric MCP API (`api.fabric.microsoft.com`) is unusual: it accepts tokens with **two different audiences**, but they grant different permission levels:

| Token Audience | Acquired Via | Read Schema | Discover Artifacts | Execute DAX |
|---|---|---|---|---|
| `https://api.fabric.microsoft.com` | `az account get-access-token --resource https://api.fabric.microsoft.com` | ✅ | ✅ | ❌ "Capacity Unauthorized" |
| `https://analysis.windows.net/powerbi/api` | Copilot CLI browser OAuth or `az ... --resource https://analysis.windows.net/powerbi/api` | ✅ | ✅ | ⚠️ Depends on `appid` |

Even with the correct audience (`analysis.windows.net/powerbi/api`), the `appid` matters. The Power BI capacity restricts which registered apps can execute DAX queries. The Copilot CLI's app (`aebc6443-...`) is registered; the Azure CLI's app (`04b07795-...`) typically is not.

**Summary:** For full Power BI MCP functionality, you need:
1. **Audience:** `https://analysis.windows.net/powerbi/api`
2. **App ID:** `aebc6443-996d-45c2-90f0-388ff96faa56` (Copilot CLI's registration)
3. **Scopes:** `user_impersonation` + `.default`

### Copilot CLI OAuth Flow (Fallback)

When the Copilot CLI starts a new session, it opens **two browser windows** for Microsoft OAuth:

```
CLI starts → opens browser to:
  https://login.microsoftonline.com/common/oauth2/v2.0/authorize
    ?client_id=aebc6443-996d-45c2-90f0-388ff96faa56
    &response_type=code
    &redirect_uri=https://vscode.dev/redirect
    &state=http://127.0.0.1:{random-port}/
    &code_challenge=...
    &code_challenge_method=S256

User picks account (e.g., user@corp.com) →
  Browser redirects to https://vscode.dev/redirect →
    vscode.dev forwards to http://127.0.0.1:{port}/ with auth code →
      CLI exchanges code for token →
        Token cached at ~/.copilot/mcp-oauth-config/{hash}.tokens.json
```

The token cache file format:

```json
{
  "accessToken": "eyJ0eXAi...",
  "expiresAt": 1772946209,
  "scope": "https://analysis.windows.net/powerbi/api/user_impersonation https://analysis.windows.net/powerbi/api/.default"
}
```

The filename is a SHA-256 hash of the OAuth config. Wingman finds the Power BI token by scanning all `.tokens.json` files and matching on `scope` containing `analysis.windows.net/powerbi/api`.

## Configuration

### `fabricAuth` Option

Control how Wingman authenticates to Fabric/Power BI MCP servers:

```typescript
import { defineConfig } from '@wingmanjs/core/config';

export default defineConfig({
  fabricAuth: 'oauth',  // default
});
```

| Value | Behavior |
|-------|----------|
| `'oauth'` | **(Default)** Standalone OAuth module — discovers auth requirements via RFC 9470, runs browser Authorization Code + PKCE flow, caches tokens to `~/.wingman/tokens/`. Exposes `/api/auth/*` routes for browser UI login. |
| `'inject'` | Legacy inject mode — acquires token via Copilot CLI cache → `az` CLI fallback, injects as `Authorization` header. No browser UI login support. |
| `'cli'` | Don't inject any token — let the SDK's CLI subprocess handle auth via its own browser OAuth. Requires interactive terminal. |
| `'none'` | No auth injection. Server must be public or pre-authenticated. |

### Strategy Comparison

| Strategy | Standalone? | DAX Works? | Browser UI? | Default? |
|----------|-------------|------------|-------------|----------|
| `'oauth'` | Yes | Yes | Yes | **Yes** |
| `'cli'` | No | Yes | No | No |
| `'inject'` | Yes | No* | No | No |
| `'none'` | Yes | N/A | N/A | No |

\* `'inject'` reads cached tokens that may have the correct `appid` for DAX (via Copilot CLI cache), but the `az` CLI fallback token typically does **not** have DAX authorization.

### When to Use Each

- **`'oauth'` (default):** Best for most apps. Runs a standalone OAuth flow from your app — no dependency on the Copilot CLI or Azure CLI. Supports browser-based login via `/api/auth/*` routes. Tokens are cached to `~/.wingman/tokens/` and reused across restarts.
- **`'inject'`:** Legacy mode. Reads the Copilot CLI's cached token (from a prior `copilot` session). Falls back to `az` CLI if no cached token exists. Does not support browser UI login.
- **`'cli'`:** Only works when the SDK subprocess can open a browser (interactive terminal). Does NOT work when your app runs as a background service.
- **`'none'`:** For MCP servers that don't require auth, or when you handle auth yourself via `mcpServers` config headers.

## OAuth 2.0 Flow (Default)

When `fabricAuth: 'oauth'` (the default), Wingman's built-in OAuth module handles the full token lifecycle:

### Discovery

On startup, Wingman probes each HTTP MCP server for **RFC 9470 resource metadata**:

```
GET https://api.fabric.microsoft.com/.well-known/oauth-authorization-server
→ 200 OK
{
  "authorization_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  "token_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  "scopes_supported": ["https://analysis.windows.net/powerbi/api/.default"]
}
```

If the server returns metadata, Wingman knows this server requires OAuth and records the discovered authorization server and scopes.

### Browser Login

When a token is needed (no cached token or cached token expired):

```
1. Wingman generates a PKCE code_verifier + code_challenge
2. Starts an ephemeral HTTP listener on localhost:{random-port}
3. Opens the user's default browser to the authorization endpoint:
     https://login.microsoftonline.com/common/oauth2/v2.0/authorize
       ?client_id=<registered-app-id>
       &response_type=code
       &redirect_uri=http://localhost:{port}/
       &scope=https://analysis.windows.net/powerbi/api/.default offline_access
       &code_challenge=<S256-challenge>
       &code_challenge_method=S256
       &state=<random-state>
4. User authenticates and consents
5. Browser redirects to http://localhost:{port}/?code=<auth-code>&state=<state>
6. Wingman exchanges the auth code for tokens at the token endpoint
7. Tokens are cached to ~/.wingman/tokens/{hash}.json
8. Ephemeral listener shuts down
```

### Token Caching

Tokens are persisted to `~/.wingman/tokens/{hash}.json` where `{hash}` is a SHA-256 of the server URL + scope combination.

**File format:**

```json
{
  "accessToken": "eyJ0eXAi...",
  "refreshToken": "0.AAAA...",
  "expiresAt": 1772946209,
  "scope": "https://analysis.windows.net/powerbi/api/.default",
  "serverUrl": "https://api.fabric.microsoft.com/v1/mcp/powerbi"
}
```

**File permissions:** `0o600` (owner read/write only). Wingman enforces this on creation and logs a warning if permissions are more permissive on existing files.

On subsequent requests, Wingman reads the cached token and checks `expiresAt` (with a 2-minute buffer). If expired but a `refreshToken` is present, it performs a silent token refresh without opening a browser.

## Auth API Routes

When `fabricAuth: 'oauth'`, Wingman's Express server exposes `/api/auth/*` endpoints that a browser UI can use to trigger and monitor OAuth login flows.

### `GET /api/auth/status`

Returns the authentication state of all configured HTTP MCP servers.

```
GET /api/auth/status

→ 200 OK
{
  "servers": [
    {
      "serverUrl": "https://api.fabric.microsoft.com/v1/mcp/powerbi",
      "name": "powerbi-remote",
      "authenticated": true,
      "expiresAt": 1772946209,
      "scopes": ["https://analysis.windows.net/powerbi/api/.default"]
    }
  ]
}
```

### `POST /api/auth/login`

Initiates an OAuth login flow for a specific MCP server. Returns a URL the browser should open and a `state` token to poll for completion.

```
POST /api/auth/login
Content-Type: application/json

{ "serverUrl": "https://api.fabric.microsoft.com/v1/mcp/powerbi" }

→ 200 OK
{
  "authUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=...&state=abc123",
  "state": "abc123"
}
```

The client should open `authUrl` in a new browser tab/window. The user completes login there, and the browser redirects to the ephemeral localhost callback.

### `GET /api/auth/wait/:state`

Long-polls until the OAuth flow identified by `:state` completes (or times out after 120 seconds).

```
GET /api/auth/wait/abc123

→ 200 OK (after user completes login)
{
  "status": "authenticated",
  "serverUrl": "https://api.fabric.microsoft.com/v1/mcp/powerbi",
  "expiresAt": 1772946209
}

→ 408 Request Timeout (if login not completed within 120s)
{
  "status": "timeout"
}
```

### `POST /api/auth/logout`

Clears cached tokens for a specific server (or all servers if no `serverUrl` provided).

```
POST /api/auth/logout
Content-Type: application/json

{ "serverUrl": "https://api.fabric.microsoft.com/v1/mcp/powerbi" }

→ 200 OK
{ "status": "logged_out" }
```

### `GET /api/auth/pending`

Returns a list of MCP server URLs that require authentication but don't have valid tokens.

```
GET /api/auth/pending

→ 200 OK
{
  "pending": [
    "https://api.fabric.microsoft.com/v1/mcp/powerbi"
  ]
}
```

### Manual Auth Headers

You can always provide explicit headers in your MCP server config:

```typescript
export default defineConfig({
  fabricAuth: 'none',
  mcpServers: {
    'my-server': {
      type: 'http',
      url: 'https://api.example.com/v1/mcp',
      headers: { Authorization: `Bearer ${process.env.MY_TOKEN}` },
      tools: ['*'],
    },
  },
});
```

## Debugging Auth Issues

### Symptom: MCP tools not discovered

If a remote MCP server's tools don't appear, the initial connection likely failed due to auth:

1. Check the discovery log on startup — is the server listed?
2. Verify a token exists: `ls ~/.copilot/mcp-oauth-config/*.tokens.json`
3. If no token, start a Copilot CLI session (`copilot`) to trigger browser login, then restart your app.

### Symptom: Tools return "Unauthorized" or "Capacity operation failed"

Authentication succeeded but authorization failed. Decode the JWT to diagnose:

```powershell
# PowerShell — decode the token your app is using
$file = Get-ChildItem ~/.copilot/mcp-oauth-config/*.tokens.json |
  Where-Object { (Get-Content $_ | ConvertFrom-Json).scope -match 'powerbi' } |
  Select-Object -First 1
$token = (Get-Content $file | ConvertFrom-Json).accessToken
$payload = $token.Split('.')[1]
$mod = $payload.Length % 4; if ($mod -gt 0) { $payload += ('=' * (4 - $mod)) }
$claims = [System.Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($payload.Replace('-','+').Replace('_','/'))
) | ConvertFrom-Json
$claims | Select-Object aud, appid, scp, upn
```

```bash
# Bash — decode the token
TOKEN=$(cat ~/.copilot/mcp-oauth-config/*.tokens.json | jq -r 'select(.scope | contains("powerbi")) | .accessToken' | head -1)
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq '{aud, appid, scp, upn}'
```

### JWT Comparison Cheat Sheet

```
✅ WORKING (Copilot CLI cached token):
  aud:   https://analysis.windows.net/powerbi/api
  appid: aebc6443-996d-45c2-90f0-388ff96faa56
  scp:   user_impersonation

❌ NOT WORKING (az CLI, wrong audience):
  aud:   https://api.fabric.microsoft.com        ← wrong!
  appid: 04b07795-8ddb-461a-bbee-02f9e1bf7b46
  scp:   user_impersonation

❌ NOT WORKING (az CLI, correct audience but wrong appid):
  aud:   https://analysis.windows.net/powerbi/api ← correct
  appid: 04b07795-8ddb-461a-bbee-02f9e1bf7b46    ← not authorized for DAX
  scp:   user_impersonation
```

### Common Fix Workflow

```
1. Start a Copilot CLI session:  copilot
2. Complete the browser login(s) when prompted
3. Close the CLI session
4. Restart your wingman app
5. The app reads the fresh token from ~/.copilot/mcp-oauth-config/
```

## Adding Auth for Other MCP Servers

To add authentication for a non-Fabric MCP server, you have three options:

### Option A — Config headers (simplest)

Provide `headers` directly in your `mcpServers` config. Good for API keys and service principals.

### Option B — Extend `injectAuthHeaders()`

Add hostname matching for your server in `wingman/src/mcp.ts`. Good when you want automatic token acquisition based on the server URL.

### Option C — Use the CLI OAuth cache

If the Copilot CLI already caches tokens for your server (e.g., WorkIQ, Dataverse), extend the token reader to match your server's scope pattern. The cache at `~/.copilot/mcp-oauth-config/` stores tokens from ALL OAuth flows the CLI has completed.

## Security Considerations

### Token Storage

- **Wingman tokens:** `~/.wingman/tokens/` contains bearer tokens. Files are created with `0o600` permissions (owner read/write only). Wingman logs a warning if existing token files have more permissive permissions.
- **CLI token cache:** `~/.copilot/mcp-oauth-config/` contains bearer tokens from the Copilot CLI. Protect this directory with appropriate filesystem permissions.
- **Token lifetime:** Cached tokens typically expire in 1 hour. Wingman applies a 2-minute buffer before considering a token expired.
- **Negative caching:** If `az` CLI token acquisition fails, Wingman waits 60 seconds before retrying to avoid repeated timeouts.

### OAuth Module Security

- **HTTPS-only metadata URLs:** The RFC 9470 resource metadata probe (`/.well-known/oauth-authorization-server`) is only performed against HTTPS URLs. HTTP URLs are rejected to prevent downgrade attacks.
- **SSRF prevention on `/api/auth/login`:** The `serverUrl` parameter is validated against the set of configured MCP servers. Requests for URLs not in the MCP server config are rejected with `400 Bad Request`. This prevents an attacker from using the auth endpoint to probe arbitrary internal URLs.
- **Fetch timeouts:** All outbound HTTP requests during discovery and token exchange enforce a 10-second timeout to prevent hanging on unresponsive servers.
- **PKCE enforcement:** The OAuth flow always uses S256 PKCE code challenges. The `code_verifier` is held in memory only and never persisted to disk.
- **Ephemeral callback listener:** The localhost callback server binds to a random high port, accepts only the expected `state` parameter, and shuts down immediately after receiving the callback.
- **Token scope:** Wingman only injects tokens for servers matching configured MCP server URLs. URL parsing prevents token leakage to untrusted servers.
