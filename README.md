# Trackem

Trackem is a lightweight Electron tray app for monitoring AI subscription usage on macOS and Windows. It currently connects to Codex and is designed for additional providers.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![License](https://img.shields.io/badge/license-MIT-black)

## Features

- Real Codex subscription usage from the 5-hour and weekly rate-limit windows
- Multiple Codex profiles with a best-account recommendation
- Plan, top local model, banked resets, reset expiry dates, and usage pace
- Reset-expiry desktop notifications
- Refresh diagnostics with per-account errors and timings
- Five-minute background refresh and manual refresh
- Native macOS menu bar and Windows system tray behavior
- Light and dark themes
- Read-only credential access: Trackem never refreshes or rewrites Codex credentials

## Multiple Codex accounts

Trackem always reads the default profile at `$CODEX_HOME` or `~/.codex`. Add other profile directories under **Settings → Codex profiles**. Each directory should contain an `auth.json` created by the Codex CLI.

For example:

```text
~/.codex
~/.codex-work
~/.codex-client
```

Trackem stores preferences in Electron's platform-specific application data directory. The configuration file is created with owner-only permissions on POSIX systems. Credential contents never cross into the renderer process; only normalized usage snapshots do.

## Development

Requirements: Node.js 22+, pnpm, and a Codex OAuth login for live usage.

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# or all three
pnpm check
```

Packaging:

```bash
pnpm dist:mac
pnpm dist:win
```

Windows packaging and tray behavior should be verified on a Windows machine before release.

## Project structure

```text
electron/
  main.ts                 Window, tray, notifications, refresh loop, and IPC
  app-logic.ts            Shared account selection and notification logic
  config.ts               Validated, private application preferences
  contracts.ts            Main, preload, and renderer IPC contracts
  preload.ts              Narrow contextBridge API
  providers/codex/        OAuth usage adapter and local session scanner
src/
  main.tsx                React application
  lib/usage.ts            Pure pace and usage calculations
  components/ui/          shadcn/ui primitives
```

## Privacy and security

- OAuth access tokens remain in the Electron main process.
- Trackem reads `auth.json` but does not modify or refresh it; the Codex CLI owns authentication.
- No analytics, accounts, remote Trackem backend, or telemetry are included.
- Logs contain status messages and profile labels, never token values.

## Status

Codex is functional. Claude and OpenCode adapters are planned and are shown as unavailable until implemented. Windows packaging has not yet been validated on physical Windows hardware.

Trackem is an independent project and is not affiliated with or endorsed by OpenAI, Anthropic, or OpenCode. Product names and marks belong to their respective owners.

## License

MIT
