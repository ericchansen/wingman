# Contributing to Wingman

Thanks for your interest in contributing to Wingman! This project aims to be the canonical open-source chat frontend for the GitHub Copilot SDK.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 9+ (`npm install -g pnpm`)
- GitHub Copilot CLI (for testing with real SDK)

### Getting Started

```bash
git clone https://github.com/ericchansen/wingman.git
cd wingman
pnpm install
pnpm build
pnpm dev
```

### Project Structure

```
packages/
├── wingman/          # Core: SDK wrapper, sessions, events, server
├── react/            # @wingman/react: hooks + components
└── create-wingman-app/  # CLI scaffolding tool

examples/
├── hello-wingman/    # Minimal example
└── enterprise-chat/  # Full-featured example

apps/
└── docs/             # Documentation site
```

### Development Commands

```bash
pnpm build          # Build all packages
pnpm dev            # Watch mode for all packages
pnpm test           # Run tests
pnpm lint           # Lint all packages
pnpm clean          # Remove all build artifacts
```

### Code Style

- TypeScript strict mode
- ESM (`"type": "module"`)
- Prettier for formatting
- Conventional commits (`feat:`, `fix:`, `docs:`, etc.)

## Architecture Principles

1. **Thin App, Smart Agent** — Wingman is a rendering layer over the Copilot SDK. Don't add intelligence to the frontend.
2. **All 51 events** — Every SDK event type must be handled. No `default: break` dropping events silently.
3. **Zero config by default** — Everything must work out of the box. Configuration is for customization, not setup.
4. **Boring default** — The default UI is intentionally generic. Personality comes from configuration.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
