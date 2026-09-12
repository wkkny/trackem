import AppKit
import TrayProtocol

final class TrayApp: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var snapshot: Snapshot?
    private var selectedID: String?
    private var timer: Timer?
    private var countdowns: [() -> Void] = []
    private var inputMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.autosaveName = "Trackem"
        if let button = statusItem.button {
            button.image = Self.mark(percent: Self.sessionPercentLeft(in: snapshot))
            button.toolTip = "Trackem: subscription usage"
            button.setAccessibilityLabel("Trackem subscription usage")
            button.target = self
            button.action = #selector(toggle)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
        inputMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if self?.popover.isShown == true && event.keyCode == 53 { self?.popover.performClose(nil); return nil }
            return event
        }
        send()
        if CommandLine.arguments.contains("--smoke-test") {
            // Exercise the real AppKit view on a desktop session without credentials
            // or invented quota values. Never enabled by the Electron launcher.
            // The launcher writes the initial snapshot at ready; consume it synchronously
            // so the rendered popover reflects real data instead of the placeholder.
            var decoder = LineDecoder()
            while snapshot == nil {
                let chunk = FileHandle.standardInput.availableData
                if chunk.isEmpty { break }
                for line in (try? decoder.append(chunk)) ?? [] {
                    if let value = try? Snapshot.decode(line) { receive(value) }
                }
            }
            render()
            if CommandLine.arguments.contains("--render-png"), let out = CommandLine.arguments.last, out.hasSuffix(".png") {
                if let content = popover.contentViewController?.view {
                    content.frame = NSRect(origin: .zero, size: popover.contentSize)
                    content.layoutSubtreeIfNeeded()
                    if let rep = content.bitmapImageRepForCachingDisplay(in: content.bounds) {
                        content.cacheDisplay(in: content.bounds, to: rep)
                        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
                    }
                }
                NSApp.terminate(nil)
                return
            }
            if let button = statusItem.button {
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            }
            DispatchQueue.main.async { self.popover.performClose(nil); NSApp.terminate(nil) }
            return
        }
        // Blocking pipe reads run off the AppKit thread. EOF means the parent is gone.
        // availableData is used because read(upToCount:) can block indefinitely on pipes.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var decoder = LineDecoder()
            do {
                while true {
                    let chunk = FileHandle.standardInput.availableData
                    guard !chunk.isEmpty else { break }
                    for line in try decoder.append(chunk) {
                        let value = try Snapshot.decode(line)
                        DispatchQueue.main.async { self?.receive(value) }
                    }
                }
            } catch { /* No payload or credential data is logged. */ }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    private func send(_ action: Action? = nil) {
        do { try FileHandle.standardOutput.write(contentsOf: Event(action: action).line()) }
        catch { NSApp.terminate(nil) }
    }
    private func receive(_ value: Snapshot) {
        snapshot = value
        if !value.accounts.contains(where: { $0.id == selectedID }) { selectedID = value.accounts.first?.id }
        let available = value.accounts.filter { $0.available }.count
        statusItem.button?.toolTip = "Trackem: \(available) connected account\(available == 1 ? "" : "s")"
        statusItem.button?.image = Self.mark(percent: Self.sessionPercentLeft(in: value))
        if popover.isShown { render() }
    }

    @objc private func toggle() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            popover.performClose(nil)
            let menu = NSMenu()
            for (title, action, shortcut) in [
                ("Open dashboard", Action.dashboard, ""),
                ("Refresh usage", .refresh, "r"),
                ("Settings…", .settings, ","),
                ("Quit Trackem", .quit, "q")
            ] {
                if action == .quit { menu.addItem(.separator()) }
                let item = NSMenuItem(title: title, action: #selector(menuAction(_:)), keyEquivalent: shortcut)
                item.target = self; item.representedObject = action.rawValue
                menu.addItem(item)
            }
            statusItem.menu = menu
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
            return
        }
        if popover.isShown { popover.performClose(nil); return }
        guard let button = statusItem.button else { return }
        render()
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        send(.opened)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.countdowns.forEach { $0() }
        }
    }
    func popoverDidClose(_ notification: Notification) { timer?.invalidate(); timer = nil }
    @objc private func menuAction(_ item: NSMenuItem) {
        if let raw = item.representedObject as? String, let action = Action(rawValue: raw) { perform(action) }
    }
    @objc private func buttonAction(_ button: NSButton) {
        if let raw = button.identifier?.rawValue, let action = Action(rawValue: raw) { perform(action) }
    }
    private func perform(_ action: Action) {
        if action != .refresh { popover.performClose(nil) }
        send(action)
    }
    @objc private func selectChip(_ button: NSButton) {
        if let id = button.identifier?.rawValue { selectedID = id }
        render()
    }

    private func label(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular, secondary: Bool = false) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = secondary ? .secondaryLabelColor : .labelColor
        field.setContentCompressionResistancePriority(.required, for: .vertical)
        return field
    }
    private func actionButton(_ title: String, symbol: String, action: Action) -> NSButton {
        let button = NSButton(title: title, target: self, action: #selector(buttonAction(_:)))
        button.identifier = NSUserInterfaceItemIdentifier(action.rawValue)
        button.bezelStyle = .rounded
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        button.imagePosition = .imageLeading
        button.imageHugsTitle = true
        button.controlSize = .regular
        button.setAccessibilityLabel(title)
        if action == .refresh { button.keyEquivalent = "r"; button.keyEquivalentModifierMask = .command }
        if action == .settings { button.keyEquivalent = ","; button.keyEquivalentModifierMask = .command }
        if action == .quit { button.keyEquivalent = "q"; button.keyEquivalentModifierMask = .command }
        return button
    }
    private func separator() -> NSBox { let box = NSBox(); box.boxType = .separator; return box }

    /** One quota row: heading, horizontal bar and right-aligned reset line. Unknown usage renders an empty bar. */
    private func quotaRow(name: String, usedPercent: Double?, resetAt: String?, updatedAt: String?) -> NSStackView {
        let left = usedPercent.map { Int((100 - $0).rounded()) }
        let heading = label(left.map { "\(name) \($0)% left" } ?? name, size: 14, weight: .semibold)
        heading.alignment = .left
        let reset = label("", size: 11, secondary: true)
        reset.alignment = .right
        let update = {
            let now = Date()
            let stale = updatedAt.flatMap { parseDate($0) }.map { now.timeIntervalSince($0) > 900 } ?? true
            let resetDue = resetAt.flatMap { parseDate($0) }.map { $0 <= now } ?? false
            if let left {
                heading.stringValue = "\(name) \(left)% left\(stale || resetDue ? " at last check" : "")"
                reset.stringValue = resetDescription(resetAt, now: now)
            } else {
                heading.stringValue = name
                reset.stringValue = "Waiting for usage…"
            }
        }
        update(); countdowns.append(update)
        let progress = NSProgressIndicator()
        progress.isIndeterminate = false
        progress.style = .bar
        progress.minValue = 0; progress.maxValue = 100; progress.doubleValue = Double(left ?? 0)
        progress.setAccessibilityLabel("\(name) quota remaining")
        progress.setAccessibilityValue("\(left ?? 0) percent")
        let stack = NSStackView(views: [heading, progress, reset])
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 4
        return stack
    }

    /** Provider chip: octagon mark plus a name for up to three accounts, icon-only beyond that. */
    private func chip(_ account: Account, named: Bool) -> NSButton {
        let button = NSButton(title: named ? account.label : "", target: self, action: #selector(selectChip(_:)))
        button.bezelStyle = .recessed
        button.image = Self.mark(percent: account.id == selectedID ? 100 : nil)
        button.imagePosition = named ? .imageLeading : .imageOnly
        button.imageHugsTitle = true
        button.identifier = NSUserInterfaceItemIdentifier(account.id)
        button.setAccessibilityLabel("\(account.label) quota")
        if account.id == selectedID { button.contentTintColor = .controlAccentColor }
        return button
    }

    private func render() {
        countdowns = []
        let controller = NSViewController()
        let background = NSVisualEffectView()
        background.material = .popover
        background.blendingMode = .withinWindow
        background.state = .active
        controller.view = background
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        background.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: background.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: background.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: background.topAnchor, constant: 18),
            stack.bottomAnchor.constraint(equalTo: background.bottomAnchor, constant: -18),
            background.widthAnchor.constraint(equalToConstant: 360)
        ])
        func add(_ view: NSView) {
            stack.addArrangedSubview(view)
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        // Unavailable providers are not an error; the user enables them in Settings.
        // They are simply absent here until Trackem can read their usage.
        let accounts = (snapshot?.accounts ?? []).filter { $0.available }
        if accounts.isEmpty {
            add(label(snapshot?.checkedAt == nil ? "Checking local provider logins…" : "Monitoring is disabled. Enable a provider in Settings.", secondary: true))
            for name in ["5-hour", "Weekly"] {
                add(quotaRow(name: name, usedPercent: nil, resetAt: nil, updatedAt: nil))
            }
        } else {
            if !accounts.contains(where: { $0.id == selectedID }) { selectedID = accounts[0].id }
            let selected = accounts.first(where: { $0.id == selectedID }) ?? accounts[0]
            let chips = NSStackView(views: accounts.map { chip($0, named: accounts.count <= 3) })
            chips.orientation = .horizontal
            chips.spacing = 6
            add(chips)
            for name in ["5-hour", "Weekly"] {
                let window = selected.windows.first(where: { ($0.id == .fiveHour) == (name == "5-hour") })
                add(quotaRow(name: name, usedPercent: window?.usedPercent, resetAt: window?.resetAt, updatedAt: selected.updatedAt))
            }
        }
        add(separator())
        add(actionButton("Open dashboard", symbol: "rectangle.grid.2x2", action: .dashboard))
        let controls = NSStackView(views: [
            actionButton("Refresh", symbol: "arrow.clockwise", action: .refresh),
            actionButton("Settings…", symbol: "gearshape", action: .settings),
            actionButton("Quit", symbol: "power", action: .quit)
        ])
        controls.spacing = 8
        add(controls)
        if let appVersion = snapshot?.appVersion {
            add(label("Trackem v\(appVersion)", size: 11, secondary: true))
        }
        background.layoutSubtreeIfNeeded()
        popover.contentViewController = controller
        popover.contentSize = NSSize(width: 360, height: max(240, stack.fittingSize.height + 36))
    }

    /**
     Menu bar mark: an octagon with pointed edges, filled vertically from the
     bottom according to how much of the session (5-hour) quota remains. A
     `nil` percent, or no session window, renders an empty outline.
     */
    private static func mark(percent: Double?) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            let octagon = NSBezierPath()
            let center: CGFloat = 9
            let radius: CGFloat = 7.5
            for index in 0..<8 {
                let angle = (CGFloat(index) / 8) * 2 * .pi + .pi / 8
                let point = NSPoint(x: center + radius * cos(angle), y: center + radius * sin(angle))
                if index == 0 { octagon.move(to: point) } else { octagon.line(to: point) }
            }
            octagon.close()
            if let percent {
                let fraction = CGFloat(max(0, min(100, percent)) / 100)
                NSGraphicsContext.current?.saveGraphicsState()
                octagon.addClip()
                NSColor.black.setFill()
                NSRect(x: 0, y: 18 * (1 - fraction), width: 18, height: 18 * fraction).fill()
                NSGraphicsContext.current?.restoreGraphicsState()
            }
            octagon.lineWidth = 1.5
            NSColor.black.setStroke()
            octagon.stroke()
            return true
        }
        image.isTemplate = true
        return image
    }

    /** Session (5-hour) window of the selected or first available account, in percent left. */
    private static func sessionPercentLeft(in snapshot: Snapshot?) -> Double? {
        guard let snapshot else { return nil }
        let account = snapshot.accounts.first(where: { $0.available })
            ?? snapshot.accounts.first
        guard let account, account.available else { return nil }
        let window = account.windows.first(where: { $0.id == .fiveHour }) ?? account.windows.first
        guard let window else { return nil }
        return max(0, min(100, 100 - window.usedPercent))
    }
}

let application = NSApplication.shared
let delegate = TrayApp()
application.delegate = delegate
application.run()
