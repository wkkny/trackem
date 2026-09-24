# Trackem

Trackem is a desktop tray app for monitoring Codex and Claude subscription usage on macOS and Windows. It reads existing CLI logins and displays provider-reported quotas. It never fills the dashboard with sample values.

Trackem uses Tauri 2 and a Rust desktop process with a React and Vite renderer. Tauri uses the system webview, WebView2 on Windows and WKWebView on macOS.

## Features

- Codex session and weekly quota windows
- Claude Code five-hour and seven-day quota windows
- Multiple Codex profiles and an account recommendation
- Forecasts based on quota changes observed in the last two hours
- Provider-reported plan and banked reset data
- Optional local Codex model statistics
- Low-quota, predicted-exhaustion, and reset-expiry notifications
- In-memory refresh diagnostics
- Five-minute background refresh, single-flight requests, failure backoff, and refresh after system resume
- Tray popover, hidden login startup, and single-instance behavior
- Light and dark themes
- Read-only credential access. Trackem never refreshes or rewrites provider credentials.
- Per-provider controls and an explanation of local files and network destinations
- Optional local retention study with review, copy, and deletion controls

## Multiple Codex accounts

No provider is selected on a fresh install. Add Codex in the app when you want Trackem to check for a local login. It checks the default profile at `$CODEX_HOME` or `~/.codex`; add other profile directories under **Settings → Codex profiles**. Each directory should contain an `auth.json` created by the Codex CLI.

For example:

```text
~/.codex
~/.codex-work
~/.codex-client
```

Trackem stores preferences in its application data directory. On first launch after the Electron migration, it copies the existing preferences and local study file into the Tauri data directory. On POSIX systems, those files use owner-only permissions. Credential contents stay in the Rust process. The renderer receives normalized usage snapshots and settings only.

## Claude setup

Add Claude Code in the app to have Trackem check for a local login. Sign in with `claude` if no login is found. API keys cannot report Claude subscription quotas. Trackem reads `.credentials.json` under `$CLAUDE_CONFIG_DIR` or `~/.claude`. On the default macOS profile, it can also read the `Claude Code-credentials` Keychain item. Custom macOS Keychain service names are not supported. Custom directories need a credential file.

On Windows, a Claude Code login inside WSL needs a Windows-accessible directory in **Settings → Claude directory**, for example `\\wsl.localhost\Ubuntu\home\you\.claude`.

The OAuth usage endpoints used by both adapters can change independently of Trackem. An unsupported response appears as unavailable. Trackem never substitutes API billing totals or local token counts for subscription quota percentages.

The Claude adapter displays the aggregate five-hour and seven-day windows. Model-specific limits and extra-usage billing are not included.

## Forecasts

Forecasts use quota changes observed during the last two hours in the same reset window. They need at least three readings spanning ten minutes. They restart after usage corrections or long gaps, and disappear when data is stale. If no usage increase appears, the run-out time stays unknown. Estimates assume the recent usage rate continues.

History stays in memory and clears when Trackem quits, a quota resets, usage is corrected, a long gap occurs, or the system resumes from sleep. Notifications fire at 10% remaining or predicted exhaustion within an hour. Trackem sends each warning once per account and quota window per app session.

## Windows

Left-click the tray icon to open the compact view. Right-click it for the native menu. Press Escape or click outside the popover to hide it. The dashboard and popover use the same React renderer. Installed Windows and macOS builds support starting hidden at login through Settings.

The Windows x64 installer creates a Start menu shortcut for notification identity. CI packages a Windows installer. See [Windows release checks](docs/windows-testing.md) for native validation and resource measurement targets.

## Early demand validation

The optional **Early feedback** study records intentional app opens and relative active days locally for up to 90 days. It includes paid-tool count, usefulness, and monthly willingness-to-pay questions. Users review a report before copying it to share with a pilot organizer. Trackem does not upload study data.

The [two-week pilot plan](docs/demand-validation.md) covers recruitment, retention definitions, interviews, and payment validation. These tools prepare the study. They do not establish demand or willingness to pay.

## Development

Requirements:

- Node.js 22 or later and pnpm 12.3.4
- The stable Rust toolchain
- Xcode Command Line Tools on macOS
- Microsoft C++ Build Tools and WebView2 on Windows

Install dependencies and start the desktop app:

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
# or run every check
pnpm check
```

Package the app:

```bash
pnpm dist:mac
pnpm dist:win
```

Tauri packages the app under `src-tauri/target/release/bundle`. Windows tray behavior and provider logins still need native validation before release.

## Project structure

```text
src-tauri/
  src/lib.rs                 Tray, window lifecycle, commands, refresh, notifications
  src/types.rs               Rust and renderer data contracts
  src/config.rs              Validated preferences and private file persistence
  src/providers/codex.rs     Codex OAuth reader and usage adapter
  src/providers/claude.rs    Claude Code credential reader and usage adapter
  src/providers/sessions.rs  Optional local Codex model scanner
  src/forecast.rs            Observed-usage forecasts
  src/research.rs            Opt-in local study and sanitized reports
  capabilities/main.json    Renderer permissions
src/
  main.tsx                   React dashboard, popover, settings, and navigation
  lib/desktop.ts             Typed Tauri command and event wrapper
  lib/usage.ts               Pure quota formatting and pace calculations
  components/ui/             Shared UI primitives
```

## Privacy and security

- OAuth tokens stay in the Rust process. Only normalized quota data crosses Tauri commands and events.
- Trackem does not modify or refresh provider credentials. The CLI owns authentication and token lifecycle.
- There is no Trackem backend or automatic telemetry. Optional study data stays local until the user copies and shares it.
- Logs contain status messages and profile labels, never token values, raw provider responses, or API error bodies.
- The Tauri capability grants the bundled `main` window access to app events. Provider and file access stay in Rust commands.
- Optional Codex model scanning is off by default. It reads local session logs and retains model statistics only. No session contents are uploaded.
- The renderer loads no third-party fonts or analytics.
- On Windows, local file protection depends on the user's application-data ACLs. Trackem does not create a separate credential vault or copy provider secrets.

## Status

The Tauri Rust core passes `cargo check`, and the React renderer builds. The previous mocked Electron tests remain in the repository as migration references. They do not cover the Rust provider adapters or Tauri lifecycle. Live Codex and Claude accounts, native Windows behavior, and installed-app interaction still need verification.

Trackem is an independent project and is not affiliated with or endorsed by OpenAI, Anthropic, or OpenCode. Product names and marks belong to their owners.

## License

MIT
