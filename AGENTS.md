# Agent Instructions

## Testing Requirements

When testing user-facing features (CLI tools, server startup, scaffolded apps):

1. **Be the user** — follow the exact printed instructions (e.g., "Open http://localhost:3000" means open it in the browser)
2. **Use browser tools** — load the URL with Chrome DevTools or Playwright. Never substitute API endpoint checks (`curl /api/health`) for visual verification.
3. **Errors are bugs, not detours** — if something crashes or fails during testing, stop and fix it. Never change ports, skip steps, or dismiss failures.
4. **Full loop or not done** — for scaffolding/CLI tools, test every step a user takes: scaffold → install → build → run → open browser → interact. If any step fails or looks wrong, that's the finding.

## Git Workflow

- **Never merge PRs** — only create PRs. The maintainer reviews and merges.
- **Never push to main/master** — always use feature branches.
- **Multiple GitHub accounts** — run `gh auth status` when git/gh operations fail. Switch with `gh auth switch --user ericchansen` for this repo.

## Conventions

- ESM throughout — all packages use `"type": "module"`, TypeScript imports require `.js` extensions for local modules.
- Changesets for versioning — add a changeset for any package changes.
- Turbo for builds/tests — `npx turbo build`, `npx turbo test`.
