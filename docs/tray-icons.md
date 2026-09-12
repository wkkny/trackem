# Tray icon directions

[Open the concept sheet](tray-icons.svg).

1. **Capacity bars.** Two rows with small gaps suggest remaining capacity. The strongest connection to Trackem's purpose, and readable at 18 points. This is the provisional native and web mark.
2. **Open dial.** A broken circle with a short needle suggests a usage meter. More familiar, but easy to confuse with performance monitors.
3. **Track T.** Two horizontal strokes and a vertical stem form a compact T. More distinctive as a product initial, less descriptive of usage.

Keep the menu-bar mark monochrome, use a template image on macOS, and avoid tiny text, gradients or provider logos. The icon should identify the app, not imply a particular percentage. Live quota state belongs in the popover until there is an explicit design for aggregating multiple accounts.

The provisional geometry lives in `packages/ui/src/brand.tsx`, `packages/ui/assets/trackem-mark.svg`, and the AppKit drawing function. Native system actions use SF Symbols; web actions and provider logos use `@trackem/ui/icons`.

The Windows tray and installer retain the existing ICO artwork. Once a direction is chosen, export a matching multi-resolution ICO and ICNS app icon. A final logo, color palette and production icon export are separate from this architecture change.
