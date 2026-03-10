---
"@wingmanjs/core": patch
"@wingmanjs/react": patch
---

fix: clear pending auth state when OAuth window is closed or cancelled

- Add "Cancel" button in default UI during OAuth wait (replaces disabled "Waiting…")
- Handle Cross-Origin-Opener-Policy (COOP) that blocks popup.closed polling
- Add cancelLogin() to useAuthStatus hook for React apps
- Prevent reverse-tabnabbing without losing popup window reference
- Guard against re-entrant sign-in when Cancel button is clicked
