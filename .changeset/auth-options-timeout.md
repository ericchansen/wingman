---
'@wingmanjs/react': minor
---

Add ChatProvider auth options and external browser auth timeout

- **ChatProvider authOptions prop** (#50): Thread auth configuration (e.g., `openAuthUrl`) through React context so built-in auth UI and custom components can consume it via `useAuthOptions()` without per-hook wiring.
- **External auth timeout** (#51): Auto-cancel pending logins after 5 minutes (configurable via `externalAuthTimeoutMs`) when auth launches in an external browser with no popup handle to detect abandonment.
