import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { app } from "electron";
import * as path from "node:path";
import type { UsageSnapshotPayload } from "@trackem/contracts";
import {
	MAX_LINE_BYTES,
	nativeSnapshot,
	parseNativeEvent,
	type NativeAction,
} from "./protocol";
import type { TrayHost } from "./types";

export function createMacOSTray(options: {
	action(action: NativeAction): void;
	failed(): void;
	ready(): void;
}): TrayHost {
	const bundle = app.isPackaged
		? path.join(process.resourcesPath, "../Frameworks/TrackemTray.app")
		: path.join(
				__dirname,
				"../../../../../native/macos-tray/build/TrackemTray.app",
			);
	const executable = path.join(bundle, "Contents/MacOS/TrackemTray");
	let child: ChildProcessWithoutNullStreams | null = null;
	let stopped = false;
	let attempts = 0;
	let restart: NodeJS.Timeout | undefined;
	let handshake: NodeJS.Timeout | undefined;
	let latest: string | undefined;
	let isReady = false;
	let blocked = false;
	let pending = false;

	function flush() {
		if (!child || !isReady || blocked || !pending || !latest) return;
		pending = false;
		blocked = !child.stdin.write(latest);
	}
	function launch() {
		if (stopped) return;
		isReady = false;
		blocked = false;
		pending = Boolean(latest);
		const processChild = spawn(executable, [], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				PATH: "/usr/bin:/bin",
				LANG: process.env.LANG ?? "en_US.UTF-8",
			},
		});
		child = processChild;
		let failed = false;
		let buffer = "";
		function fail() {
			if (failed || stopped) return;
			failed = true;
			clearTimeout(handshake);
			isReady = false;
			processChild.kill();
			options.failed();
			if (attempts < 3) restart = setTimeout(launch, 1000 * 2 ** attempts++);
		}
		handshake = setTimeout(fail, 10_000);
		processChild.on("error", fail);
		processChild.on("exit", fail);
		processChild.stdin.on("error", fail);
		processChild.stdout.on("error", fail);
		processChild.stderr.on("error", fail);
		processChild.stdin.on("drain", () => {
			if (!failed) {
				blocked = false;
				flush();
			}
		});
		// Drain stderr without forwarding arbitrary output or inheriting OAuth environment.
		processChild.stderr.resume();
		processChild.stdout.setEncoding("utf8");
		processChild.stdout.on("data", (chunk: string) => {
			if (failed || stopped) return;
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
				fail();
				return;
			}
			let end = buffer.indexOf("\n");
			while (end !== -1) {
				const event = parseNativeEvent(buffer.slice(0, end));
				buffer = buffer.slice(end + 1);
				if (!event) {
					fail();
					return;
				}
				if (event.type === "ready") {
					if (isReady) {
						fail();
						return;
					}
					clearTimeout(handshake);
					isReady = true;
					options.ready();
					flush();
				} else if (isReady) options.action(event.action);
				else {
					fail();
					return;
				}
				end = buffer.indexOf("\n");
			}
		});
	}
	launch();
	return {
		update(payload: UsageSnapshotPayload) {
			latest = JSON.stringify(nativeSnapshot(payload)) + "\n";
			pending = true;
			flush();
		},
		stop() {
			stopped = true;
			clearTimeout(restart);
			clearTimeout(handshake);
			child?.stdin.end();
			child?.kill();
			child = null;
		},
	};
}
