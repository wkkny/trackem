import { app, BrowserWindow, screen, type WebContents } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { UsageSnapshotPayload } from "@trackem/contracts";
import { popoverBounds } from "./tray";

type Page = "Overview" | "Settings";
type View = "dashboard" | "popover";
const file = path.join(__dirname, "../../dist/index.html");
const devURL = "http://localhost:5173/";

export function createWindows(options: {
	opened(): void;
	error(message: string): void;
}) {
	let dashboard: BrowserWindow | null = null;
	let popover: BrowserWindow | null = null;
	let page: Page = "Overview";
	let quitting = false;
	const ready = new WeakSet<BrowserWindow>();
	const pendingShow = new WeakSet<BrowserWindow>();
	const views = new Map<BrowserWindow, View>();

	function url(view: View) {
		const target = new URL(app.isPackaged ? pathToFileURL(file).href : devURL);
		target.searchParams.set("view", view);
		return target.href;
	}
	function trusted(sender: WebContents) {
		return [...views].some(
			([window, view]) =>
				!window.isDestroyed() &&
				sender === window.webContents &&
				sender.getURL() === url(view),
		);
	}
	function reveal(window: BrowserWindow) {
		if (!ready.has(window)) {
			pendingShow.add(window);
			return;
		}
		window.show();
		window.focus();
		options.opened();
	}
	function create(view: View) {
		const compact = view === "popover";
		const window = new BrowserWindow({
			width: compact ? 420 : 1080,
			height: compact ? 560 : 760,
			minWidth: compact ? 1 : 760,
			minHeight: compact ? 1 : 600,
			resizable: !compact,
			frame: false,
			...(process.platform === "darwin" && !compact
				? {
						titleBarStyle: "hidden" as const,
						trafficLightPosition: { x: 20, y: 20 },
					}
				: {}),
			backgroundColor: "#f7f8fa",
			show: false,
			skipTaskbar: compact,
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: true,
			},
		});
		views.set(window, view);
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		window.webContents.on("will-attach-webview", (event) =>
			event.preventDefault(),
		);
		window.webContents.session.setPermissionRequestHandler(
			(_contents, _permission, callback) => callback(false),
		);
		window.webContents.session.setPermissionCheckHandler(() => false);
		window.webContents.on("before-input-event", (event, input) => {
			if (input.key === "Escape") {
				pendingShow.delete(window);
				window.hide();
				event.preventDefault();
			}
		});
		window.once("ready-to-show", () => {
			ready.add(window);
			if (pendingShow.delete(window)) reveal(window);
		});
		window.on("blur", () => {
			if (compact) window.hide();
		});
		window.on("close", (event) => {
			if (!quitting) {
				event.preventDefault();
				window.hide();
			}
		});
		window.on("closed", () => {
			views.delete(window);
			if (window === dashboard) dashboard = null;
			if (window === popover) popover = null;
		});
		const loading = app.isPackaged
			? window.loadFile(file, { query: { view } })
			: window.loadURL(url(view));
		void loading.catch(() => options.error("Could not load the app window."));
		return window;
	}
	function showDashboard(nextPage?: Page) {
		if (nextPage) page = nextPage;
		if (!dashboard) dashboard = create("dashboard");
		if (popover) {
			pendingShow.delete(popover);
			popover.hide();
		}
		if (nextPage) dashboard.webContents.send("window:navigate", page);
		reveal(dashboard);
	}
	return {
		initialize(hidden: boolean) {
			// Do not create a Chromium window for a hidden login launch.
			if (!hidden) showDashboard();
		},
		showDashboard,
		togglePopover(anchor: Electron.Rectangle) {
			if (!popover) popover = create("popover");
			if (popover.isVisible() || pendingShow.has(popover)) {
				pendingShow.delete(popover);
				popover.hide();
				return;
			}
			popover.setBounds(
				popoverBounds(anchor, screen.getDisplayMatching(anchor).workArea),
			);
			popover.setAlwaysOnTop(true, "pop-up-menu");
			reveal(popover);
		},
		hide(sender: WebContents) {
			for (const window of views.keys())
				if (window.webContents === sender) {
					pendingShow.delete(window);
					window.hide();
				}
		},
		publish(payload: UsageSnapshotPayload) {
			for (const window of views.keys())
				if (!window.isDestroyed())
					window.webContents.send("usage:updated", payload);
		},
		page: () => page,
		trusted,
		stop: () => {
			quitting = true;
		},
	};
}
