import AppKit
import TrackemCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let client = CodexUsageClient()
    private let menu = NSMenu()
    private var statusItem: NSStatusItem?
    private var refreshTask: Task<Void, Never>?
    private var refreshTimer: Timer?
    private var lastRefresh: Date?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(systemSymbolName: "gauge.with.dots.needle.50percent", accessibilityDescription: "Trackem") {
            image.isTemplate = true
            item.button?.image = image
        } else {
            item.button?.title = "C"
        }
        item.button?.toolTip = "Trackem"
        menu.delegate = self
        item.menu = menu
        statusItem = item

        showLoadingMenu()
        refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        refreshTimer?.invalidate()
        refreshTask?.cancel()
    }

    func menuWillOpen(_ menu: NSMenu) {
        if lastRefresh.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
            refresh()
        }
    }

    @objc private func refreshFromMenu() {
        refresh()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func refresh() {
        guard refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            guard let self else { return }
            do {
                let snapshot = try await client.fetch()
                guard !Task.isCancelled else { return }
                lastRefresh = Date()
                show(snapshot)
            } catch {
                guard !Task.isCancelled else { return }
                lastRefresh = Date()
                show(error)
            }
            refreshTask = nil
        }
    }

    private func showLoadingMenu() {
        menu.removeAllItems()
        addLabel("Loading Codex usage...")
        addActions()
    }

    private func show(_ snapshot: UsageSnapshot) {
        menu.removeAllItems()
        addLabel("Plan: \(DisplayFormatter.plan(snapshot.plan))")
        menu.addItem(.separator())

        if let fiveHour = snapshot.fiveHour {
            addLabel("5-hour usage: \(DisplayFormatter.percentLeft(fiveHour.usedPercent))% left")
            addLabel("Resets in: \(DisplayFormatter.fiveHourReset(fiveHour.resetAt))")
        } else {
            addLabel("5-hour usage: Unavailable")
        }
        addLabel("Banked resets: \(snapshot.bankedResets.map(String.init) ?? "Unavailable")")
        menu.addItem(.separator())

        if let weekly = snapshot.weekly {
            addLabel("Weekly usage: \(DisplayFormatter.percentLeft(weekly.usedPercent))% left")
            addLabel("Resets in: \(DisplayFormatter.weeklyReset(weekly.resetAt))")
        } else {
            addLabel("Weekly usage: Unavailable")
        }
        addActions()
    }

    private func show(_ error: Error) {
        menu.removeAllItems()
        addLabel("Codex usage unavailable")
        addLabel((error as? LocalizedError)?.errorDescription ?? "Try again.")
        addActions()
    }

    private func addLabel(_ title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        menu.addItem(item)
    }

    private func addActions() {
        menu.addItem(.separator())

        let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshFromMenu), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        let quitItem = NSMenuItem(title: "Quit Trackem", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = AppDelegate()
    application.delegate = delegate
    application.run()
}
