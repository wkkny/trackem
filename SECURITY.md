# Security

Trackem is local software. It has no server, analytics, telemetry, or web renderer.

## Credentials

Trackem reads the Codex CLI OAuth token from `$CODEX_HOME/auth.json` or `~/.codex/auth.json`. It never modifies that file, refreshes the token, or stores a copy.

The token stays inside the AppKit process on macOS or the Electron main process on Windows. Trackem sends it only to the Codex usage and reset-credit HTTPS endpoints. Requests reject redirects and use a ten-second timeout.

Trackem does not log response bodies or include them in displayed errors.

## Reporting issues

Do not include `auth.json`, OAuth tokens, account identifiers, or raw provider responses in bug reports.
