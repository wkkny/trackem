# Security

Please report security issues privately through GitHub's security advisory feature rather than a public issue.

Trackem reads local provider credentials in the Electron main process. Reports involving credential exposure, unsafe IPC, or unintended file writes are especially welcome.

## Data access

- Codex credentials come from `auth.json` in the default or explicitly configured CLI directories. Claude credentials come from `.credentials.json` or the default Claude Code macOS Keychain service.
- Only HTTPS requests to the provider's usage endpoints receive access tokens. Requests reject redirects and time out. Trackem never stores, refreshes, or modifies these tokens.
- Provider tokens, raw API error bodies, and credential command output never cross IPC. The renderer receives normalized quota data, profile labels and paths, and sanitized errors.
- The renderer runs sandboxed with context isolation and no Node integration. New windows, navigation, and browser permission requests are denied. The clipboard action only copies a generated study report.
- The Swift/AppKit tray receives an allowlisted display summary through bounded, versioned stdin/stdout messages. It receives no account IDs, emails, paths, credentials, diagnostics or arbitrary provider errors. Its actions are restricted to opening the dashboard/settings, refreshing, quitting, and recording an intentional open.
- The macOS helper is a separate process, not an OS-sandboxed security boundary. It runs as the current user, but its code has no credential or network access. The website is a separate static build with no Electron dependencies or local account data.
- Preferences and optional research data use owner-only POSIX modes. Windows relies on the current user's application-data ACLs. No local encryption claim is made.
- Optional model scanning reads Codex session files, including lines that may contain prompts, but retains only model statistics. It is off by default and sends no session contents over the network.
- Opt-in study reports allow only relative active days, total opens, study age, enabled state, and predefined survey choices. The app never uploads them.
