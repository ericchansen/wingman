# @wingmanjs/react

## 3.0.0

### Minor Changes

- d91c9b3: feat(auth): group MCP servers by OAuth provider in connections panel

  Servers requiring OAuth are now grouped by provider (e.g. "Microsoft", "Google", "GitHub") in the auth settings panel. Each group shows a "Sign in to all" button for batch authentication. The /api/auth/status endpoint returns both flat servers and grouped data.

- b793222: feat(auth): add openAuthUrl option for desktop/Electron OAuth flows

  The useAuthStatus hook now accepts an optional openAuthUrl function for launching OAuth URLs in the system browser instead of window.open(). Desktop/Electron apps can pass shell.openExternal to use the user's default browser profile for sign-in.

### Patch Changes

- 69f26e6: fix: clear pending auth state when OAuth window is closed or cancelled
  - Add "Cancel" button in default UI during OAuth wait (replaces disabled "Waiting…")
  - Handle Cross-Origin-Opener-Policy (COOP) that blocks popup.closed polling
  - Add cancelLogin() to useAuthStatus hook for React apps
  - Prevent reverse-tabnabbing without losing popup window reference
  - Guard against re-entrant sign-in when Cancel button is clicked

- Updated dependencies [d91c9b3]
- Updated dependencies [0d15188]
- Updated dependencies [69f26e6]
  - @wingmanjs/core@0.4.0

## 2.0.0

### Patch Changes

- Updated dependencies [c92a4b9]
  - @wingmanjs/core@0.3.0

## 1.1.1

### Patch Changes

- Updated dependencies [f7e9d7c]
  - @wingmanjs/core@0.2.2

## 1.1.0

### Minor Changes

- 97c9584: Add MessageSegment types to core. Upgrade ChatProvider with all 17 SSE event types, ordered segment model, fetchWithRetry, configurable toolDisplayNames, debug events. Add useAuthStatus, useChatHistory, useIsMobile hooks.

### Patch Changes

- Updated dependencies [97c9584]
  - @wingmanjs/core@0.2.1

## 1.0.0

### Patch Changes

- d8c62c5: Standalone OAuth auth for remote HTTP MCP servers (Power BI, Fabric). Apps work without Copilot CLI. Includes auth module, /api/auth/\* routes, smart server classification, session invalidation, timeout removal, and security hardening.
- Updated dependencies [d8c62c5]
  - @wingmanjs/core@0.2.0

## 0.1.2

### Patch Changes

- 7306b2c: Fix Power BI MCP authentication, add fabricAuth config, useAutoScroll hook
  - Fix Power BI DAX execution: read CLI cached OAuth tokens with correct appid from ~/.copilot/mcp-oauth-config/
  - Add three-tier token acquisition: CLI cache → az CLI fallback → none
  - Add `fabricAuth` config option ('inject' | 'cli' | 'none') to WingmanConfig
  - Add MCP server config validation and session creation summary
  - Detect orphaned MCP tool calls that never complete
  - Handle MCP array result format, warn on empty tool results
  - Extract error message from SDK tool.execution_complete events
  - Add `useAutoScroll` hook to @wingmanjs/react (scroll-up detection, auto-resume)
  - Add comprehensive MCP auth documentation (docs/mcp-auth.md)

- Updated dependencies [7306b2c]
  - @wingmanjs/core@0.1.2

## 0.1.1

### Patch Changes

- 1802a72: Add publishConfig with public access for scoped packages
- Updated dependencies [1802a72]
  - @wingmanjs/core@0.1.1
