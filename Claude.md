# Claude Code notes for Trackem

## Start here

Trackem is an Electron 44 desktop app with a Vite 8 React 19 renderer. Use pnpm 12.3.4 and Node.js 22+.

```bash
pnpm install
pnpm check
pnpm dev
```

The dev command runs Vite on `http://localhost:5173/` and launches Electron. The Codex harness may export `ELECTRON_RUN_AS_NODE=1`; remove it for a real Electron launch:

```bash
env -u ELECTRON_RUN_AS_NODE -u CODEX_CI pnpm dev
```

## Mental model

The main process owns provider access and all secrets. The preload script exposes only the typed `window.trackem` API. The renderer receives account labels, paths, normalized usage windows, forecasts, diagnostics, and config payloads.

The refresh path is:

1. `apps/desktop/electron/usage-service.ts` checks enabled providers on startup, manually, from the tray popover, and every five minutes.
2. `apps/desktop/electron/providers/codex/index.ts` discovers profiles and reads each `auth.json` without writing it.
3. `apps/desktop/electron/providers/claude/index.ts` reads `.credentials.json`, with the default macOS Keychain fallback.
4. Adapters call provider OAuth usage endpoints and normalize supported five-hour and weekly windows.
5. The main process adds in-memory forecast data and notifications, then publishes `usage:updated` over IPC.
6. `apps/desktop/src/main.tsx` renders the cached snapshot in the dashboard or compact tray popover.

Manual refresh is single-flight and has a 30-second cooldown for ordinary polling. Provider failures produce unavailable snapshots, not invented percentages. The main process backs off when every enabled account fails.

## Claude provider details

Claude monitoring uses:

- Credential file: `${CLAUDE_CONFIG_DIR}/.credentials.json` or `~/.claude/.credentials.json`.
- macOS fallback: `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w` for the default profile only.
- Endpoint: `https://api.anthropic.com/api/oauth/usage`.
- Headers: OAuth Bearer token, `anthropic-beta: oauth-2025-04-20`, and JSON `Accept`.

The adapter accepts `five_hour` and `seven_day` windows with numeric `utilization` from 0 through 100. Invalid or missing windows make the snapshot unavailable. It reports the aggregate windows only. Model-specific limits and extra-usage billing are intentionally not shown.

API keys are not subscription credentials and must not be treated as quota data. Do not add browser-cookie support or token refresh logic.

On Windows, a Claude Code login inside WSL needs a Windows-readable path in Settings, such as `\\wsl.localhost\Ubuntu\home\you\.claude`.

## Codex provider details

Codex monitoring always includes the default profile from `CODEX_HOME` or `~/.codex`, then configured profile directories. Each profile should contain `auth.json`. The adapter calls the usage and reset-credit endpoints on `chatgpt.com` and sends the account ID header when available.

The optional model scan reads bounded recent Codex session files. It is off by default because those files can contain prompts. It keeps model totals only.

## Security constraints

- Never put OAuth tokens in renderer state, config, logs, diagnostics, reports, or test snapshots.
- Never include raw provider response bodies in user-facing errors.
- Keep `contextIsolation`, `sandbox`, and `nodeIntegration: false` intact.
- Keep navigation, new windows, and permission requests blocked.
- Preserve sender checks on every IPC handler.
- Keep config and study writes owner-only on POSIX systems.
- Do not broaden local file reads without updating the settings explanation and `SECURITY.md`.

## Testing and release status

Run these after adapter or lifecycle changes:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Current local result: 82 Vitest tests pass in 11 files and six Swift protocol tests pass, TypeScript and builds pass, and macOS arm64 packaging completes unsigned. Biome still emits non-blocking warnings in tests.

Mocked adapter tests cover malformed credentials, expired credentials, HTTP failures, timeouts, retries, unsupported responses, profile discovery, and token redaction. They do not prove that live provider endpoints still match the adapters.

Native Windows behavior remains unverified. Before release, run every step in `docs/windows-testing.md`, including installed tray interaction, multi-monitor positioning, Windows notifications, startup settings, WSL paths, sleep/resume, live quotas, and resource measurements.

## Editing guidance

Keep changes narrow and update tests with behavior changes. Shared contracts live in `packages/contracts/src/index.ts`; do not duplicate them in the renderer. Prefer pure functions for normalization and forecast logic. Use the existing UI primitives and Tailwind classes. Do not add placeholder quotas, telemetry, or network calls outside the provider adapters.

## Workspace architecture

The desktop app lives in `apps/desktop`; the public Vite SPA lives in `apps/website`. Shared React/shadcn components, CSS and icons belong in `packages/ui`. There is no chat feature today; reusable chat components can be added there when needed.

On macOS, `native/macos-tray` owns the Swift/AppKit status item and popover. `apps/desktop/electron/trays/macos.ts` supervises it through a bounded, versioned display-only pipe protocol. No credentials, account IDs, emails, paths or provider errors go to the helper. On Windows, `trays/electron-tray.ts` uses Electron Tray and `windows.ts` owns separate dashboard/popover BrowserWindows. `usage-service.ts` owns polling independently of UI.

Read `docs/architecture.md` and `docs/macos-testing.md` before changing these boundaries. Native builds require Xcode or Command Line Tools; native tests use Swift Testing and need Swift 6+. Packaging output is `apps/desktop/release`; website output is `apps/website/dist`. macOS packaging currently matches the host architecture. Signing/notarization, native interaction checks and live quota comparisons remain release requirements.
