# Trackem

Trackem is an Electron tray app for monitoring Codex and Claude subscription usage on macOS and Windows. It reads existing CLI logins and displays provider-reported quotas without sample values.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![License](https://img.shields.io/badge/license-MIT-black)

## Features

- Real Codex subscription usage from the 5-hour and weekly rate-limit windows
- Real Claude subscription usage through the Claude Code OAuth login
- Multiple Codex profiles with a best-account recommendation
- Observed-usage forecasts that estimate exhaustion before the next reset
- Provider-reported plan and banked reset data when available; optional local model statistics
- Low-quota, predicted-exhaustion, and reset-expiry desktop notifications
- Refresh diagnostics with per-account errors and timings
- Five-minute background refresh, single-flight requests, failure backoff, and sleep/resume handling
- Compact tray popover, hidden login startup, and single-instance behavior
- Light and dark themes
- Read-only credential access: Trackem never refreshes or rewrites Codex credentials
- Per-provider access controls and an in-app explanation of local files and network destinations
- Optional local retention study, willingness-to-pay questions, and a reviewable report with no automatic upload

## Multiple Codex accounts

Trackem always reads the default profile at `$CODEX_HOME` or `~/.codex`. Add other profile directories under **Settings → Codex profiles**. Each directory should contain an `auth.json` created by the Codex CLI.

For example:

```text
~/.codex
~/.codex-work
~/.codex-client
```

Trackem stores preferences in Electron's platform-specific application data directory. The configuration file is created with owner-only permissions on POSIX systems. Credential contents never cross into the renderer process; only normalized usage snapshots do.

## Claude setup

Sign in using Claude Code with `claude`, then refresh Trackem. API keys cannot report Claude subscription quotas. Trackem reads `.credentials.json` under `$CLAUDE_CONFIG_DIR` or `~/.claude`. For the default macOS profile, it can also read the `Claude Code-credentials` Keychain entry. Custom macOS Keychain service names are not supported; custom directories need a credential file.

On Windows, a Claude Code login inside WSL needs a Windows-accessible directory in **Settings → Claude directory**, for example `\\wsl.localhost\Ubuntu\home\you\.claude`.

The OAuth usage endpoints used by both adapters can change independently of Trackem. An unsupported response appears as unavailable. Trackem never substitutes API billing totals or local token counts for subscription quota percentages.

The Claude adapter currently displays the aggregate five-hour and seven-day windows. Model-specific limits and extra-usage billing are not included.

## Forecasts

Forecasts use quota changes observed during the last two hours in the same reset window. They need at least three readings spanning ten minutes, restart after usage corrections or long gaps, and stop presenting estimates when data is stale. No usage increase means the run-out time is unknown. Estimates assume the recent usage rate continues.

History stays in memory and clears when Trackem quits. Notifications fire at 10% remaining or predicted exhaustion within an hour, at most once per account and quota window per app session. Restarting the app resets notification deduplication.

## Windows

Left-click the tray for the compact view, right-click for the native menu, and use Escape or click outside to dismiss the popover. The dashboard and popover reuse one renderer. Installed Windows and macOS builds support starting hidden at login through Settings.

The Windows x64 installer creates a Start menu shortcut for notification identity. CI checks Windows builds and packages an installer. See [Windows release checks](docs/windows-testing.md) for native validation and resource measurement targets.

## Early demand validation

The optional **Early feedback** study records intentional app opens and relative active days locally for up to 90 days. It includes paid-tool count, usefulness, and monthly willingness-to-pay questions. Users review a report before copying it to share with a pilot organizer. Opting out deletes study data.

The [two-week pilot plan](docs/demand-validation.md) covers recruitment, retention definitions, interviews, and payment validation. These tools prepare the study; they do not establish demand or willingness to pay.

## Development

Requirements: Node.js 22+, pnpm, and a Codex or Claude Code OAuth login for live usage.

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
  config.ts               Validated, private application preferences
  contracts.ts            Main, preload, and renderer IPC contracts
  preload.ts              Narrow contextBridge API
  providers/codex/        OAuth usage adapter and local session scanner
  providers/claude/       Claude Code credential reader and OAuth usage adapter
  forecast.ts             Observed-usage forecasts
  research.ts             Opt-in local study and sanitized reports
  tray.ts                 Display-aware popover positioning
src/
  main.tsx                React application
  lib/usage.ts            Pure pace and usage calculations
  components/ui/          shadcn/ui primitives
```

## Privacy and security

- OAuth access tokens remain in the Electron main process.
- Trackem does not modify or refresh either provider's credentials; the CLI owns authentication.
- There is no remote Trackem backend or automatic telemetry. Optional study data stays local until the user copies and shares it.
- Logs contain status messages and profile labels, never token values or API error bodies. Logs and quota history stay in memory.
- Optional Codex model scanning is off by default. It reads local session logs and retains only model statistics. No session contents are uploaded.
- Fonts use the OS font stack. The renderer loads no third-party fonts or analytics.
- On Windows, local file protection depends on your user-profile ACLs. Trackem does not create a separate credential vault or copy provider secrets.

## Status

Codex and Claude adapters are implemented with mocked-response tests. Live account access and native Windows behavior must be verified before release. OpenCode is not offered as a connectable subscription provider. Windows performance targets have not yet been measured on physical Windows hardware.

Trackem is an independent project and is not affiliated with or endorsed by OpenAI, Anthropic, or OpenCode. Product names and marks belong to their respective owners.

## License

MIT
