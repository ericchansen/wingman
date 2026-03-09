# @wingmanjs/core

## 0.2.1

### Patch Changes

- 97c9584: Add MessageSegment types to core. Upgrade ChatProvider with all 17 SSE event types, ordered segment model, fetchWithRetry, configurable toolDisplayNames, debug events. Add useAuthStatus, useChatHistory, useIsMobile hooks.

## 0.2.0

### Minor Changes

- d8c62c5: Standalone OAuth auth for remote HTTP MCP servers (Power BI, Fabric). Apps work without Copilot CLI. Includes auth module, /api/auth/\* routes, smart server classification, session invalidation, timeout removal, and security hardening.

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

## 0.1.1

### Patch Changes

- 1802a72: Add publishConfig with public access for scoped packages
