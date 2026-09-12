# Architecture

Trackem uses a pnpm workspace because the desktop app and website share React components and brand assets, but have separate build and release targets. There is no task orchestrator beyond pnpm.

## Ownership

| Location | Owns | Must not own |
| --- | --- | --- |
| `apps/desktop/electron` | Credentials, provider HTTP, polling, notifications, preferences, local research | Website code |
| `apps/desktop/electron/windows.ts` | Sandboxed dashboard and Windows popover windows | Quota calculations |
| `apps/desktop/electron/trays` | Electron tray, native process supervision, display DTO mapping | Credential reads |
| `apps/desktop/src` | Shared macOS/Windows dashboard and Windows compact view | Node or provider access |
| `native/macos-tray` | Swift/AppKit menu-bar item and popover | Network, credential files, business logic |
| `apps/website` | Public Vite SPA | Electron imports, local account data |
| `packages/contracts` | TypeScript data and preload contracts | Runtime services |
| `packages/core` | Pure forecasts, formatting and quota calculations | Electron, React, filesystem or network |
| `packages/ui` | shadcn primitives, CSS tokens, web icons, provisional brand mark | Desktop globals or provider access |

Existing shadcn components live in `@trackem/ui/components/*`. Import a component by subpath rather than through one package-wide barrel. Each Vite app compiles the shared source and scans its own classes. The native UI does not render those React components; it uses AppKit controls and SF Symbols.

There is no chat feature today. Future reusable chat components belong in `packages/ui`; conversation state and app-specific actions belong in the app that uses them.

## Desktop lifecycle

`main.ts` composes `usage-service.ts`, the window controller, and a platform tray. Provider reads remain in the Electron main process. Five-minute polling, single-flight requests, backoff, forecasts, notifications and suspend/resume behavior are retained.

The dashboard and Windows popover are different BrowserWindows. Window identity comes from a fixed `?view=` query, not from the shared usage payload. Opening Settings from either native tray updates the dashboard page. A hidden login launch creates no renderer until it is needed.

Every preload request validates the owned webContents, exact renderer URL and main frame. Both windows keep sandboxing, context isolation and no Node integration. Navigation, webviews, permission requests and new windows are blocked.

The user-data location remains the existing `trackem` directory under the platform's application-data folder. Renaming the workspace package does not move preferences.

## macOS

The bundled `TrackemTray.app` is an accessory app written in Swift:

- `NSStatusItem` draws an 18-point template icon that follows menu-bar appearance.
- `NSPopover` anchors the compact UI to the status button and dismisses on outside interaction.
- `NSVisualEffectView`, `NSPopUpButton`, `NSTextField`, `NSProgressIndicator`, `NSButton`, and `NSBox` provide native appearance and accessibility.
- Right-click opens an `NSMenu`. Escape closes the popover. Command-R refreshes, Command-comma opens Settings, and Command-Q quits.

Electron launches the helper directly without a shell. Newline-delimited JSON travels over inherited stdin/stdout pipes; there is no listening socket. Both sides require protocol version 1 and bound each line to 256 KiB.

`trays/protocol.ts` constructs a display-only snapshot. It sends provider names, generic profile labels, plans, quota windows, reset times and banked-reset counts. It omits account IDs, email addresses, filesystem paths, model scans, diagnostics and arbitrary provider error messages. The helper can request only dashboard, settings, refresh, quit and opened actions.

The bridge waits for a ready handshake, coalesces writes under backpressure, allows three automatic restarts and then leaves a recovery menu with Retry. EOF terminates the helper when Electron goes away. Normal app shutdown closes the pipe and terminates the helper.

This is not a fully native macOS app. Electron still hosts the dashboard and provider service, so it still contributes to memory usage when the native tray is visible.

## Builds and releases

`pnpm build` builds contracts/core, the Electron renderer/main process, the Vite website, and the native helper on macOS. Native commands skip on Windows/Linux. The build requires macOS 13+ and Swift 5.9+; native tests use Swift Testing and require Swift 6+ and a recent macOS developer toolchain.

`scripts/native.mjs` builds a helper for the host architecture, creates its accessory app bundle, and applies an ad-hoc development signature. The test command handles the newer Command Line Tools layout for the Swift Testing compiler plugin.

`pnpm dist:mac` embeds it at `Trackem.app/Contents/Frameworks/TrackemTray.app`. Run packaging on the matching architecture. This workflow does not produce a universal helper; do not pass an Electron cross-architecture flag without adding a matching native build first. Developer ID signing and notarization still need release credentials and verification.

`pnpm dist:win` builds an x64 NSIS installer with no Swift requirement. Outputs go to `apps/desktop/release`. CI uploads platform installers and a separate website artifact.

The website output is `apps/website/dist`. Deploy that folder to a static host; it does not require an application server. If client-side routes are added later, configure the host to rewrite unknown routes to `index.html`. For subdirectory hosting, set Vite's `base`.

## Adding a feature

Add provider reads only inside the desktop provider adapters. Extend the shared contracts and tests if normalized data changes. For native tray display changes, update both the TypeScript DTO mapper and Swift decoder/tests. Keep richer dashboard-only details out of the helper unless the tray needs them.

New web UI belongs in the shared UI package when both apps use it. Keep website sections and dashboard-specific business views in their own apps. Share data contracts and brand geometry across native/web boundaries, not a universal UI abstraction.

## Verification

Run `pnpm check` for workspace lint, types, Vitest, Swift protocol tests on macOS, and builds. Adapter tests use mocked responses. The helper bridge tests cover version/action validation, redaction, split messages, handshake timeout, bounded restarts, backpressure and shutdown.

Before release, also run [macOS checks](macos-testing.md) and [Windows checks](windows-testing.md). Compilation and mocked lifecycle tests do not establish native interaction, live quota accuracy, accessibility or performance.

## API references

- [Apple NSPopover](https://developer.apple.com/documentation/appkit/nspopover)
- [Apple NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem)
- [Electron Tray](https://www.electronjs.org/docs/latest/api/tray)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
