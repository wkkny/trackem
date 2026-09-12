# Trackem agent guide

Trackem is a private Codex usage monitor with no renderer or backend.

- macOS runs a Swift AppKit `NSStatusItem` app.
- Windows runs an Electron `Tray` app with a native `Menu`.

Both implementations read the existing Codex CLI OAuth login. They show the plan type, 5-hour and weekly usage, reset countdowns, and available banked 5-hour resets.

## Fast path

Use Node.js 22+, pnpm 12.3.4, and Swift 5.9+ on macOS.

```bash
pnpm install
pnpm check
pnpm dev
```

Useful checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:mac
pnpm build:electron
```

## Source map

- `macos/Sources/Trackem/main.swift`: AppKit app lifecycle, `NSStatusItem`, and `NSMenu`.
- `macos/Sources/TrackemCore/`: macOS Codex OAuth reader, usage client, and formatting.
- `electron/main.ts`: Windows Electron tray lifecycle and menu.
- `electron/menu.ts`: pure Windows menu formatting.
- `electron/providers/codex/`: Windows Codex OAuth reader and usage client.
- `scripts/platform.mjs`: selects the native macOS or Electron Windows command.
- `scripts/build-macos-app.sh`: builds `dist/Trackem.app`.

## Implementation rules

- Keep OAuth tokens inside the platform process.
- Never log or display tokens, raw provider responses, prompts, or API error bodies.
- Never refresh, rewrite, or delete Codex credentials.
- Only use provider-reported subscription quota percentages and banked reset counts.
- Preserve unavailable states when credentials or provider data are missing.
- Requests must use HTTPS, reject redirects, and time out.
- Keep both platform menus small and equivalent.

## Safe workflow

Inspect the relevant source and tests before editing. Use `apply_patch` for file changes. Run the smallest checks first, then `pnpm check` when practical. Do not add fake quota values.
