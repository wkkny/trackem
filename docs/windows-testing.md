# Windows testing

Test the packaged NSIS build on a physical Windows 11 machine before release.

1. Install Codex CLI and run `codex login`.
2. Install Trackem and confirm one tray icon appears without a window or taskbar button.
3. Open the native tray menu and compare the plan, 5-hour usage, banked resets, weekly usage, and reset countdowns with the Codex usage page.
4. Select Refresh and confirm the menu updates.
5. Test missing credentials, an expired login, malformed `auth.json`, offline mode, and provider errors. The menu must show unavailable data without invented values.
6. Resume the computer from sleep and confirm Trackem refreshes.
7. Select Quit Trackem and confirm the process exits.

The Windows implementation has no renderer, BrowserWindow, preload script, or IPC bridge.
