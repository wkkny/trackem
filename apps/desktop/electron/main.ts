import {
	app,
	Notification,
	ipcMain,
	powerMonitor,
	clipboard,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
} from "electron";
import * as path from "node:path";
import {
	DEFAULT_CONFIG,
	loadConfig,
	saveConfig,
	normalizeConfig,
	type TrackemConfig,
} from "./config";
import { LocalResearch } from "./research";
import { createUsageService } from "./usage-service";
import { createWindows } from "./windows";
import { createElectronTray } from "./trays/electron-tray";
import { createMacOSTray } from "./trays/macos";
import type { TrayHost, TrayActions } from "./trays/types";
import type { ConfigPayload } from "@trackem/contracts";

// Preserve the existing user-data location after renaming the workspace package.
app.setName("trackem");
app.setPath("userData", path.join(app.getPath("appData"), "trackem"));
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
if (process.platform === "darwin") app.dock?.hide();
if (process.platform === "win32") app.setAppUserModelId("com.trackem.app");

let config: TrackemConfig = { ...DEFAULT_CONFIG };
let configFile = "";
let research: LocalResearch;
let tray: TrayHost | undefined;
let recovery: TrayHost | undefined;
let quitting = false;
const startupSupported = () =>
	app.isPackaged && ["win32", "darwin"].includes(process.platform);
const loginSettings = () => app.getLoginItemSettings({ args: ["--hidden"] });

const windows = createWindows({
	opened() {
		recordOpen();
		usage.opened();
	},
	error: (message) => usage.addDiagnostic("error", "system", message),
});
const usage = createUsageService({
	getConfig: () => config,
	appVersion: app.getVersion(),
	onChange(payload) {
		windows.publish(payload);
		tray?.update(payload);
	},
	canNotify: () => Notification.isSupported(),
	onNotify(title, body) {
		const notification = new Notification({ title, body });
		notification.on("click", () => windows.showDashboard());
		notification.show();
	},
});

function recordOpen() {
	try {
		research?.recordOpen();
	} catch {
		usage.addDiagnostic("error", "system", "Could not save local study data");
	}
}
const actions: TrayActions = {
	dashboard: () => windows.showDashboard("Overview"),
	settings: () => windows.showDashboard("Settings"),
	refresh: () => {
		void usage.refresh(true);
	},
	quit: () => app.quit(),
	opened: () => {
		recordOpen();
		usage.opened();
	},
	togglePopover: (anchor) => windows.togglePopover(anchor),
	retry: () => {
		tray?.stop();
		startTray();
	},
};
function startTray() {
	if (process.platform !== "darwin") {
		tray = createElectronTray(actions);
	} else {
		tray = createMacOSTray({
			action: (action) => {
				if (!quitting) actions[action]();
			},
			failed() {
				usage.addDiagnostic(
					"error",
					"system",
					"Native tray unavailable. A recovery menu is available in the menu bar.",
				);
				if (!recovery && !quitting)
					recovery = createElectronTray(actions, true);
			},
			ready() {
				recovery?.stop();
				recovery = undefined;
				usage.addDiagnostic("info", "system", "Native macOS tray connected");
			},
		});
	}
	tray.update(usage.payload());
}
function trusted(event: IpcMainEvent | IpcMainInvokeEvent) {
	return (
		windows.trusted(event.sender) &&
		event.senderFrame === event.sender.mainFrame
	);
}
function assertTrusted(event: IpcMainInvokeEvent) {
	if (!trusted(event))
		throw new Error("Blocked IPC request from an untrusted renderer");
}
function configPayload(): ConfigPayload {
	return { config, file: configFile, startupSupported: startupSupported() };
}

if (hasLock)
	void app
		.whenReady()
		.then(() => {
			configFile = path.join(app.getPath("userData"), "config.json");
			config = loadConfig(configFile, (message) =>
				usage.addDiagnostic("error", "system", message),
			);
			if (startupSupported())
				config.launchAtLogin = loginSettings().openAtLogin;
			research = new LocalResearch(
				path.join(app.getPath("userData"), "research.json"),
				config.localResearch,
			);
			usage.addDiagnostic("info", "system", "Trackem started");
			startTray();
			windows.initialize(
				process.argv.includes("--hidden") ||
					(process.platform === "darwin" && loginSettings().wasOpenedAtLogin),
			);
			void usage.refresh();
			powerMonitor.on("suspend", usage.suspend);
			powerMonitor.on("resume", usage.resume);
		})
		.catch(() => {
			console.error("Trackem failed to start.");
			app.quit();
		});

app.on("second-instance", () => windows.showDashboard());
app.on("activate", () => windows.showDashboard());
ipcMain.handle("window:page", (event) => {
	assertTrusted(event);
	return windows.page();
});
ipcMain.handle("usage:get", (event) => {
	assertTrusted(event);
	return usage.payload();
});
ipcMain.handle("usage:refresh", (event) => {
	assertTrusted(event);
	return usage.refresh(true);
});
ipcMain.handle("config:get", (event) => {
	assertTrusted(event);
	return configPayload();
});
ipcMain.handle("config:set", async (event, value: unknown) => {
	assertTrusted(event);
	await usage.idle();
	const next = normalizeConfig(value);
	if (startupSupported() && next.launchAtLogin !== config.launchAtLogin) {
		app.setLoginItemSettings({
			openAtLogin: next.launchAtLogin,
			args: ["--hidden"],
		});
		next.launchAtLogin = loginSettings().openAtLogin;
	} else if (!startupSupported()) next.launchAtLogin = false;
	config = saveConfig(configFile, next);
	research.setEnabled(config.localResearch);
	usage.clearHistory();
	usage.addDiagnostic("info", "system", "Preferences saved");
	await usage.refresh(true);
	return configPayload();
});
ipcMain.handle("research:get", (event) => {
	assertTrusted(event);
	return research.report();
});
ipcMain.handle("research:save", (event, answers: unknown) => {
	assertTrusted(event);
	return research.save(answers);
});
ipcMain.handle("research:clear", (event) => {
	assertTrusted(event);
	return research.clear();
});
ipcMain.handle("research:copy", (event) => {
	assertTrusted(event);
	clipboard.writeText(JSON.stringify(research.report(), null, 2));
});
ipcMain.on("window:dashboard", (event) => {
	if (trusted(event)) windows.showDashboard();
});
ipcMain.on("app:quit", (event) => {
	if (trusted(event)) app.quit();
});
ipcMain.on("window:minimize", (event) => {
	if (trusted(event)) windows.hide(event.sender);
});
app.on("window-all-closed", () => undefined);
app.on("before-quit", () => {
	quitting = true;
	usage.stop();
	windows.stop();
	tray?.stop();
	recovery?.stop();
});
