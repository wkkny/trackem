import { app, Menu, Tray, nativeImage } from "electron";
import * as path from "node:path";
import type { UsageSnapshotPayload } from "@trackem/contracts";
import type { TrayActions, TrayHost } from "./types";

/** Windows tray, also used as an explicit recovery menu if the macOS helper fails. */
export function createElectronTray(
	actions: TrayActions,
	recovery = false,
): TrayHost {
	const directory = app.isPackaged
		? process.resourcesPath
		: path.join(__dirname, "../../..", "build");
	const template = nativeImage.createFromPath(
		path.join(directory, "trayTemplate.png"),
	);
	if (process.platform === "darwin") template.setTemplateImage(true);
	const tray = new Tray(
		process.platform === "darwin" ? template : path.join(directory, "icon.ico"),
	);
	const menu = () =>
		Menu.buildFromTemplate([
			...(recovery
				? [
						{ label: "Native tray unavailable", enabled: false },
						{ label: "Retry native tray", click: actions.retry },
					]
				: []),
			{ label: "Open dashboard", click: actions.dashboard },
			{ label: "Refresh usage", click: actions.refresh },
			{ label: "Settings…", click: actions.settings },
			{ type: "separator" },
			{ label: "Quit Trackem", click: actions.quit },
		]);
	tray.setToolTip(
		recovery
			? `Trackem v${app.getVersion()}: native tray unavailable`
			: `Trackem v${app.getVersion()}: usage at a glance`,
	);
	tray.on("click", () =>
		recovery
			? tray.popUpContextMenu(menu())
			: actions.togglePopover(tray.getBounds()),
	);
	tray.on("right-click", () => tray.popUpContextMenu(menu()));
	return {
		update(payload: UsageSnapshotPayload) {
			if (recovery) return;
			const parts = [...payload.codex, ...payload.claude]
				.filter((s) => s.ok && Object.keys(s.windows).length)
				.map(
					(s) =>
						`${s.providerId === "codex" ? "Codex" : "Claude"} ${Math.round(100 - Math.max(...Object.values(s.windows).map((w) => w.usedPercent)))}% left`,
				);
			tray.setToolTip(
				(parts.length
					? `Trackem v${app.getVersion()}: ${parts.join(" · ")}`
					: `Trackem v${app.getVersion()}: no connected providers`
				).slice(0, 127),
			);
		},
		stop: () => tray.destroy(),
	};
}
