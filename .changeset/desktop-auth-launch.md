---
'@wingmanjs/react': minor
---

feat(auth): add openAuthUrl option for desktop/Electron OAuth flows

The useAuthStatus hook now accepts an optional openAuthUrl function for launching OAuth URLs in the system browser instead of window.open(). Desktop/Electron apps can pass shell.openExternal to use the user's default browser profile for sign-in.
