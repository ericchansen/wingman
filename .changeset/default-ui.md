---
"@wingmanjs/core": minor
---

Add built-in chat UI served at `/` when no `staticDir` is configured. New apps created with `create-wingman-app` now show a working chat interface immediately. Also fixes `reasoningEffort` compatibility — models that don't support it are automatically retried without it, and SSE error events are now properly displayed in the UI.
