---
'@wingmanjs/core': minor
'@wingmanjs/react': minor
---

feat(auth): group MCP servers by OAuth provider in connections panel

Servers requiring OAuth are now grouped by provider (e.g. "Microsoft", "Google", "GitHub") in the auth settings panel. Each group shows a "Sign in to all" button for batch authentication. The /api/auth/status endpoint returns both flat servers and grouped data.
