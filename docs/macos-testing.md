# macOS release checks

Run `pnpm check` and `pnpm dist:mac` on the target architecture. Test the packaged app, not just the Vite development session.

On a macOS desktop session, `pnpm build:native && node scripts/native-smoke.mjs` briefly opens an empty native popover and verifies construction and clean exit. It uses no credentials or sample quotas. It does not replace keyboard, VoiceOver or live-data checks.

1. Confirm one Trackem menu-bar icon and one TrackemTray helper. Open a second app instance and confirm it opens the existing dashboard.
2. Left-click the status item. Confirm a real AppKit popover, account selection, readable quota bars and reset countdowns. Check empty, disabled, unavailable and multi-profile states. Expired resets must request a refresh, not refill a bar locally.
3. Click outside and press Escape in separate trials. Test right-click, Command-R, Command-comma and Command-Q. Settings must open the Settings page even before the dashboard has loaded.
4. Test light/dark menu bars, increased contrast, reduced transparency, VoiceOver, full keyboard access, small screens and multiple monitors. Native appearance follows the OS, independently of the dashboard's theme preference.
5. Stop only this app's helper process during a development session. Confirm bounded restart and recovery-menu behavior. Quit Electron and confirm its helper exits; no orphan menu-bar item should remain.
6. Enable login startup in an installed build. It must launch hidden with no dashboard renderer. Confirm the existing preferences survive the workspace migration.
7. Compare live Codex and Claude quota windows with their provider pages. Verify network failures, expired CLI credentials, suspend/resume, notification delivery and profile changes. Trackem must not rewrite authentication.
8. Measure combined Electron and Swift process CPU/memory. Native tray UI does not remove Electron's background-process cost.
9. For release, verify the nested helper and outer app signatures, hardened runtime and notarization using the configured Developer ID. Test Gatekeeper on another Mac. Local ad-hoc/unsigned packages are not release-ready.

Automated clicking in this workspace requires macOS Accessibility permission, which has not been granted. These interaction checks remain manual; do not bypass or silently alter system permissions.
