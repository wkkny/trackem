# Trackem agent guide

## What this project is

Trackem is a private Electron tray app for Codex and Claude Code subscription usage. The Electron main process reads existing CLI OAuth credentials, calls provider usage endpoints, and sends normalized snapshots to a sandboxed React renderer. Trackem does not refresh or rewrite provider credentials.

Supported providers:

- Codex, using the default `$CODEX_HOME` or `~/.codex`, plus up to 20 configured profile directories containing `auth.json`.
- Claude Code, using `$CLAUDE_CONFIG_DIR` or `~/.claude/.credentials.json`. On the default macOS profile it can also read the `Claude Code-credentials` Keychain item.

There is no Trackem backend or automatic telemetry. Optional model scanning and the local research study are off by default.

## Fast path

Use Node.js 22+ and pnpm 12.3.4.

```bash
pnpm install
pnpm check
pnpm dev
```

Useful individual checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dist:mac
pnpm dist:win
```

The root development command builds shared packages and the Swift helper on macOS, then starts Vite and Electron. The launcher clears `ELECTRON_RUN_AS_NODE` and `CODEX_CI`. Run `pnpm dev:website` separately for the Vite SPA on port 5174.

## Source map

- `apps/desktop/src/main.tsx`: renderer app, dashboard, tray popover, navigation, theme, provider display, and refresh controls.
- `apps/desktop/src/components/settings.tsx`: provider access, extra profiles, startup, notifications, model scanning, and research settings.
- `apps/desktop/src/components/research.tsx`: local study answers, report preview, copy, and deletion.
- `packages/ui/src/components/`: shared UI primitives.
- `packages/core/src/usage.ts`: pure quota formatting and pace calculations.
- `apps/desktop/electron/main.ts`: app composition, IPC, notifications, configuration and single-instance handling.
- `packages/contracts/src/index.ts`: shared main/preload/renderer data contracts.
- `apps/desktop/electron/preload.ts`: the narrow `window.trackem` contextBridge API.
- `apps/desktop/electron/config.ts`: config defaults, validation, path expansion, and private file persistence.
- `apps/desktop/electron/providers/codex/`: Codex OAuth reader, usage adapter, reset-credit adapter, profile discovery, and optional session-log scanner.
- `apps/desktop/electron/providers/claude/index.ts`: Claude Code credential reader, macOS Keychain fallback, and usage adapter.
- `packages/core/src/forecast.ts`: observed-usage forecasts. History is in memory and is cleared on restart, quota reset, corrections, long gaps, and resume from sleep.
- `apps/desktop/electron/research.ts`: opt-in local study persistence and sanitized reports.
- `apps/desktop/electron/tray.ts`: work-area-aware popover placement.
- `apps/desktop/electron/**/*.test.ts`, `packages/core/src/*.test.ts`, `native/macos-tray/Tests`: current test coverage. Provider network responses are mocked.

## Important implementation rules

- Keep OAuth tokens in the Electron main process. Do not send tokens, raw provider responses, prompts, or API error bodies across IPC.
- Keep provider data read-only. The CLI owns authentication and token lifecycle.
- Only use provider-reported subscription quota percentages. Do not infer quota from local token counts or API billing data.
- Preserve unavailable states when credentials are missing, expired, malformed, offline, or the provider response changes.
- Provider requests must remain HTTPS, reject redirects, time out, and avoid leaking response bodies.
- Keep the renderer sandboxed with context isolation and no Node integration. IPC handlers must validate the sender.
- If changing the shared data shape, update `packages/contracts/src/index.ts`, the preload API, renderer types, adapters, and tests together.
- Optional Codex session scanning may read files containing prompts. It must retain only model statistics and remain opt-in.
- Preferences and research files are private local files. POSIX writes use mode `0600`; Windows relies on the application-data ACL.

## What is verified here

At the time this guide was written:

- `pnpm check` passes.
- TypeScript checks pass for the renderer, Electron source, and Electron tests.
- 82 Vitest tests pass across 11 test files; six Swift protocol tests also pass.
- The renderer build and Electron build pass.
- `pnpm dist:mac` completes locally as an unsigned arm64 ZIP and DMG.
- Development Electron stays running when `ELECTRON_RUN_AS_NODE` and `CODEX_CI` are unset.

Biome still reports non-blocking warnings, mostly `any` and non-null assertions in tests.

## Known release gaps

- Live Codex and Claude accounts have not been verified in this workspace. Provider OAuth endpoints can change independently of Trackem.
- Native Windows tray behavior, notifications, startup-at-login behavior, WSL paths, and installed-app interaction still require a Windows machine.
- Windows performance targets in `docs/windows-testing.md` are targets, not measurements.
- There are no renderer interaction tests. Most provider coverage uses mocked responses.
- Packaging is unsigned in local development. CI disables automatic code-signing discovery.

Before claiming release readiness, follow `docs/windows-testing.md`, compare live quotas with each provider, and record native performance measurements.

## Safe workflow

Inspect the relevant source and tests before editing. Prefer `apply_patch` for file changes. Do not reset or overwrite unrelated work. After code changes, run the smallest relevant tests first, then `pnpm check` when practical. Do not add sample quota values or fake provider data to make the UI look populated.

## Workspace architecture

The desktop app lives in `apps/desktop`; the public Vite SPA lives in `apps/website`. Shared React/shadcn components, CSS and icons belong in `packages/ui`. There is no chat feature today; reusable chat components can be added there when needed.

On macOS, `native/macos-tray` owns the Swift/AppKit status item and popover. `apps/desktop/electron/trays/macos.ts` supervises it through a bounded, versioned display-only pipe protocol. No credentials, account IDs, emails, paths or provider errors go to the helper. On Windows, `trays/electron-tray.ts` uses Electron Tray and `windows.ts` owns separate dashboard/popover BrowserWindows. `usage-service.ts` owns polling independently of UI.

Read `docs/architecture.md` and `docs/macos-testing.md` before changing these boundaries. Native builds require Xcode or Command Line Tools; native tests use Swift Testing and need Swift 6+. Packaging output is `apps/desktop/release`; website output is `apps/website/dist`. macOS packaging currently matches the host architecture. Signing/notarization, native interaction checks and live quota comparisons remain release requirements.
