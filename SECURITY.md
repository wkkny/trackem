# Security

Please report security issues privately through GitHub's security advisory feature rather than a public issue.

Trackem reads local provider credentials in the Tauri Rust process. Reports involving credential exposure, unsafe command access, or unintended file writes are especially welcome.

## Data access

- Codex credentials come from `auth.json` in the default or explicitly configured CLI directories. Claude credentials come from `.credentials.json` or the default Claude Code macOS Keychain service.
- Only HTTPS requests to the provider's usage endpoints receive access tokens. Requests reject redirects and time out. Trackem never stores, refreshes, or modifies these tokens.
- Provider tokens, raw API error bodies, and credential command output never cross Tauri commands or events. The renderer receives normalized quota data, profile labels and paths, and sanitized errors.
- The renderer has no Node.js or direct filesystem access. The Tauri capability applies to the bundled `main` window. Rust commands expose only the app operations used by the renderer.
- The clipboard command only copies a generated study report.
- Preferences and optional research data use owner-only POSIX modes. Windows relies on the current user's application-data ACLs. Trackem makes no local encryption claim.
- Optional model scanning reads Codex session files, including lines that may contain prompts, but keeps only model statistics. It is off by default and sends no session contents over the network.
- Opt-in study reports contain relative active days, total opens, study age, enabled state, and predefined survey choices. Trackem never uploads them.
- During the Electron-to-Tauri migration, Trackem copies existing preferences and research data into the Tauri data directory if the destination files do not exist. It does not copy credentials.
