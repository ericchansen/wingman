# MCP Server Authentication

Wingman automatically handles authentication for remote MCP servers that require OAuth tokens. This document explains how auth works, how to configure it, and how to debug token issues.

## How It Works

When Wingman discovers HTTP-based MCP servers (like Power BI at `api.fabric.microsoft.com`), it needs to inject an `Authorization: Bearer <token>` header for the server to accept connections. Without a valid token, the MCP server won't complete the handshake and no tools will be discovered.

### Token Acquisition Strategy

Wingman uses a **three-tier fallback** to acquire tokens for Fabric/Power BI MCP servers:

```
┌─────────────────────────────┐
│ 1. In-process cache         │  ← Fastest (sub-millisecond)
│    Cached from prior call   │
└────────────┬────────────────┘
             │ expired/miss
┌────────────▼────────────────┐
│ 2. Copilot CLI OAuth cache  │  ← Best token (correct appid + scopes)
│    ~/.copilot/mcp-oauth-    │
│    config/*.tokens.json     │
└────────────┬────────────────┘
             │ not found/expired
┌────────────▼────────────────┐
│ 3. Azure CLI fallback       │  ← Metadata-only (schema/discover work,
│    az account get-access-   │     DAX execution may fail)
│    token                    │
└─────────────────────────────┘
```

**Why the Copilot CLI token is preferred:** The CLI uses OAuth app `aebc6443-996d-45c2-90f0-388ff96faa56` with browser-based login. This app registration is authorized for full Power BI operations including DAX query execution. The Azure CLI app (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) can authenticate to the API but is typically not authorized for DAX execution on Power BI capacities — it only gets metadata-level access.

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

### Copilot CLI OAuth Flow

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
  fabricAuth: 'inject',  // default
});
```

| Value | Behavior |
|-------|----------|
| `'inject'` | **(Default)** Acquire token via CLI cache → `az` CLI fallback, inject as `Authorization` header |
| `'cli'` | Don't inject any token — let the SDK's CLI subprocess handle auth via its own browser OAuth. Requires interactive terminal. |
| `'none'` | No auth injection. Server must be public or pre-authenticated. |

### When to Use Each

- **`'inject'` (default):** Best for most apps. Reads the Copilot CLI's cached token (from a prior `copilot` session) so your app doesn't need its own OAuth flow. Falls back to `az` CLI if no cached token exists.
- **`'cli'`:** Only works when the SDK subprocess can open a browser (interactive terminal). Does NOT work when your app runs as a background service.
- **`'none'`:** For MCP servers that don't require auth, or when you handle auth yourself via `mcpServers` config headers.

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

- **Token scope:** Wingman only injects tokens for servers matching `*.fabric.microsoft.com` hostnames. URL parsing prevents token leakage to untrusted servers.
- **Cache file access:** `~/.copilot/mcp-oauth-config/` contains bearer tokens. Protect this directory with appropriate filesystem permissions.
- **Token lifetime:** Cached tokens typically expire in 1 hour. Wingman applies a 2-minute buffer before considering a token expired.
- **Negative caching:** If `az` CLI token acquisition fails, Wingman waits 60 seconds before retrying to avoid repeated timeouts.
