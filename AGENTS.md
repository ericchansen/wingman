# Agent Instructions

## ⚠️ MANDATORY: Verify After EVERY Change

**This is non-negotiable. "Build passes" is NOT verification.**

After ANY code change — including PR review fixes, refactors, "small" tweaks, and "obviously correct" changes:

1. **Start the app** — `npx tsx src/server.ts` (or equivalent)
2. **Open the browser** — use Playwright to navigate to the URL
3. **Exercise every changed flow** — click buttons, open panels, submit forms, trigger errors
4. **Take a screenshot** — visual proof that it works
5. **Only THEN say it's done**

### Why This Rule Exists

Multiple times in this repo's history, "build passes + tests pass" was treated as proof that changes work. Every single time, browser testing revealed real bugs:
- `sessionId: null` sent as JSON null → 400 error (only visible in browser)
- `reasoningEffort` incompatibility → server error (only visible in browser)
- SSE errors silently swallowed (only visible in browser)
- CSS/HTML rendering issues (only visible in browser)

**If you didn't open it in a browser, you don't know if it works. Period.**

## Testing Requirements

When testing user-facing features (CLI tools, server startup, scaffolded apps):

1. **Be the user** — follow the exact printed instructions (e.g., "Open http://localhost:3000" means open it in the browser)
2. **Use browser tools** — load the URL with Chrome DevTools or Playwright. Never substitute API endpoint checks (`curl /api/health`) for visual verification.
3. **Errors are bugs, not detours** — if something crashes or fails during testing, stop and fix it. Never change ports, skip steps, or dismiss failures.
4. **Full loop or not done** — for scaffolding/CLI tools, test every step a user takes: scaffold → install → build → run → open browser → interact. If any step fails or looks wrong, that's the finding.
5. **Re-verify after review fixes** — addressing PR review comments is a code change. The same verification rules apply. Do not assume "small" fixes are correct.

## Git Workflow

- **Never merge PRs** — only create PRs. The maintainer reviews and merges.
- **Never push to main/master** — always use feature branches.
- **Multiple GitHub accounts** — run `gh auth status` when git/gh operations fail. Switch with `gh auth switch --user ericchansen` for this repo.

## Conventions

- ESM throughout — all packages use `"type": "module"`, TypeScript imports require `.js` extensions for local modules.
- Changesets for versioning — add a changeset for any package changes.
- Turbo for builds/tests — `npx turbo build`, `npx turbo test`.
