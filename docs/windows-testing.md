# Windows release checks

CI compiles the Tauri app on Windows, macOS, and Linux. On Windows it also builds the x64 NSIS installer and uploads it as an artifact. CI does not verify tray interaction, notification delivery, installed-app startup, or live provider logins.

## Installed-app smoke test

Use Windows 11 with normal display scaling. Repeat the positioning checks at 150% and 200%. Test a second monitor with a negative coordinate origin and a taskbar on each supported edge.

1. Install for the current user. Confirm the Start menu shortcut exists and the tray icon appears before provider requests finish. Open a second instance and confirm there is still only one tray icon.
2. Left-click the tray. Check that the compact quota view stays inside the monitor work area, scrolls with many profiles, and opens from cached data without waiting for the network. Click outside it and press Escape in separate trials. Both should hide it. Right-click and check the Open dashboard, Refresh usage, and Quit Trackem actions.
3. Open the dashboard, hide it, and repeat 20 times. Check keyboard navigation, focus, text clipping, light and dark themes, and taskbar auto-hide.
4. Enable Launch at login, save, and sign out and back in. The app should start hidden. Disable it, save, and repeat. Also disable the app through Windows Startup Apps, then reopen Trackem and confirm the toggle reflects Windows.
5. Sign in through Codex and Claude Code. Compare both windows with the provider's usage pages. Test additional Codex directories and a WSL Claude directory. Missing credentials, expired logins, API-key-only authentication, and offline mode must display unavailable data, not fabricated percentages.
6. Leave the app running for three or more five-minute readings while using a provider. Confirm the estimate appears only after enough readings. Sleep for 20 minutes, resume, and verify the estimate returns to collecting. Check again across a real quota reset.
7. Near an actual low quota, check notification delivery and suppression of repeats in the same quota window. Disable quota notifications and reset-expiry notifications separately. Check Windows notification settings and Do Not Disturb when testing delivery.
8. Opt in to local research, open the tray on two days, preview and copy the report, then opt out. Confirm the research file is deleted from the path shown in Settings. Confirm the report contains no credentials, paths, or account identity.

## Resource measurements

Measure the installed release build. Developer tools and the Vite server distort these numbers. Record hardware, Windows version, account count, model-scan setting, and app version.

- After five minutes of warmup, measure tray click to first paint across 20 opens. Initial target: median below 100 ms and p95 below 200 ms.
- Keep the window hidden for ten minutes. Measure the Trackem process and its WebView2 processes in Task Manager or Windows Performance Recorder. Initial target: under 0.5% average idle CPU and under 150 MB combined working set. These are targets, not measured claims.
- Repeat with 20 profiles and with the optional model scan enabled. Record refresh duration, peak memory, and responsiveness during scans. Scans read at most 100 recent files, use at most 32 MB per scan, and cache results for 15 minutes.
- Disconnect the network. Requests should time out, not overlap, and back off up to 30 minutes if every enabled account fails. Resume should clear forecast history and start a fresh check.

Record failures and actual measurements in the release notes. Native Windows validation remains required even when CI passes.
