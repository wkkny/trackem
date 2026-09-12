# Trackem

Trackem shows Codex subscription usage in the operating system menu. It has no dashboard, renderer, backend, telemetry, or settings screen.

The menu contains:

- the Codex plan type;
- remaining 5-hour usage and its reset countdown;
- available banked 5-hour resets;
- remaining weekly usage and its reset countdown;
- Refresh and Quit actions.

macOS uses an AppKit `NSStatusItem`. Windows uses Electron's native `Tray` and `Menu` APIs.

## Authentication

Trackem reads the OAuth login already created by the Codex CLI. It checks `$CODEX_HOME/auth.json` when `CODEX_HOME` is set, otherwise `~/.codex/auth.json`.

If the file is missing or expired, run:

```bash
codex login
```

Trackem never writes to the login file or refreshes the token. It sends the token only to these HTTPS endpoints and rejects redirects:

```text
https://chatgpt.com/backend-api/wham/usage
https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
```

## Development

Use Node.js 22+, pnpm 12.3.4, and Swift 5.9+ on macOS.

```bash
pnpm install
pnpm check
pnpm dev
```

`pnpm dev` runs the AppKit app on macOS and the Electron tray app on Windows.

Platform-specific commands:

```bash
pnpm dev:mac
pnpm dev:win
pnpm build:mac
pnpm build:electron
pnpm dist:mac
pnpm dist:win
```

The macOS distribution command creates `dist/Trackem.app` with an ad-hoc local signature. The Windows distribution command creates the Electron NSIS installer.

## Source layout

```text
macos/
  Sources/Trackem/          AppKit status item and native menu
  Sources/TrackemCore/      Codex login, requests, and formatting
electron/
  main.ts                   Windows tray lifecycle and native menu
  menu.ts                   Menu text and countdown formatting
  providers/codex/          Windows Codex login and requests
scripts/                    Platform runner and macOS app bundler
```
