# Trackem agent guide

## What this project is

Trackem is a Tauri 2 desktop tray app for Codex and Claude Code subscription usage. The Rust process reads existing CLI OAuth credentials, calls provider usage endpoints, and sends normalized snapshots to a React renderer. Trackem does not refresh or rewrite provider credentials.

Supported providers:

- Codex, using the default `$CODEX_HOME` or `~/.codex`, plus up to 20 configured profile directories containing `auth.json`.
- Claude Code, using `$CLAUDE_CONFIG_DIR` or `~/.claude/.credentials.json`. On the default macOS profile it can also read the `Claude Code-credentials` Keychain item.

There is no Trackem server or automatic telemetry. Optional model scanning and the local research study are off by default.

## Fast path

Use Node.js 22+, pnpm 12.3.4, and the stable Rust toolchain.

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

macOS development requires Xcode Command Line Tools. Windows development requires Microsoft C++ Build Tools and WebView2.

## Source map

- `src/main.tsx`: React dashboard, tray popover, navigation, theme, provider display, and refresh controls.
- `src/components/settings.tsx`: provider access, extra profiles, startup, notifications, model scanning, and research settings.
- `src/components/research.tsx`: local study answers, report preview, copy, and deletion.
- `src/components/ui/`: shared UI primitives.
- `src/lib/desktop.ts`: typed Tauri commands and events.
- `src/lib/usage.ts`: pure quota formatting and pace calculations.
- `src-tauri/src/lib.rs`: app lifecycle, tray, window, refresh loop, forecasts, notifications, commands, and single-instance handling.
- `src-tauri/src/types.rs`: Rust data contracts serialized to the renderer.
- `src-tauri/src/config.rs`: config defaults, validation, path expansion, and private file persistence.
- `src-tauri/src/providers/codex.rs`: Codex OAuth reader and usage adapter.
- `src-tauri/src/providers/claude.rs`: Claude Code credential reader, macOS Keychain fallback, and usage adapter.
- `src-tauri/src/providers/sessions.rs`: optional local session-log scanner.
- `src-tauri/src/forecast.rs`: observed-usage forecasts.
- `src-tauri/src/research.rs`: opt-in local study persistence and sanitized reports.
- `src-tauri/capabilities/main.json`: permissions for the bundled renderer.

The `electron/` directory holds the previous TypeScript implementation and its tests as migration references. Those tests do not cover the Rust adapters or Tauri lifecycle.

## Important implementation rules

- Keep OAuth tokens in the Rust process. Do not send tokens, raw provider responses, prompts, or API error bodies across Tauri commands or events.
- Keep provider data read-only. The CLI owns authentication and token lifecycle.
- Only use provider-reported subscription quota percentages. Do not infer quota from local token counts or API billing data.
- Preserve unavailable states when credentials are missing, expired, malformed, offline, or the provider response changes.
- Provider requests must remain HTTPS, reject redirects, time out, and avoid leaking response bodies.
- Keep filesystem and network access in Rust. Expose only the command needed by each renderer action.
- If changing shared data, update `src-tauri/src/types.rs`, `src/types.ts`, `src/lib/desktop.ts`, provider adapters, and relevant callers together.
- Optional Codex session scanning may read files containing prompts. It must retain only model statistics and remain opt-in.
- Preferences and research files are private local files. POSIX writes use mode `0600`; Windows relies on the application-data ACL.

## Current verification

- `cargo check --manifest-path src-tauri/Cargo.toml` passes in this workspace.
- `pnpm build:renderer` passes.
- Native tray interaction, notifications, login startup, installed-app behavior, and live provider logins have not been verified after the Tauri migration.
- Existing Vitest checks exercise the previous Electron TypeScript implementation. They do not validate Rust provider behavior or Tauri lifecycle.

## Known release gaps

- Live Codex and Claude accounts have not been verified in this workspace. Provider OAuth endpoints can change independently of Trackem.
- Native Windows tray behavior, notifications, startup-at-login behavior, WSL paths, and installed-app interaction still require a Windows machine.
- Windows performance targets in `docs/windows-testing.md` are targets, not measurements.
- Rust provider and Tauri lifecycle tests have not been ported from the Electron implementation.
- Tauri builds are unsigned in local development.

Before claiming release readiness, follow `docs/windows-testing.md`, compare live quotas with each provider, and record native performance measurements.

## Safe workflow

Inspect the relevant source and current changes before editing. Prefer `apply_patch` for file changes. Do not reset or overwrite unrelated work. Do not add sample quota values or fake provider data to make the UI look populated.
