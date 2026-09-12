import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSnapshotPayload } from "@trackem/contracts";
import { createMacOSTray } from "./macos";

const state = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: state.spawn }));
vi.mock("electron", () => ({ app: { isPackaged: true } }));
class Child extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	kill = vi.fn();
}
const payload: UsageSnapshotPayload = {
	codex: [],
	claude: [],
	diagnostics: [],
	lastCheckedAt: null,
	appVersion: "0.1.0",
};
let children: Child[];
function childAt(index = 0) {
	const child = children[index];
	if (!child) throw new Error("Expected a spawned native helper");
	return child;
}
let host: ReturnType<typeof createMacOSTray>;
let options: {
	action: ReturnType<typeof vi.fn<() => void>>;
	failed: ReturnType<typeof vi.fn<() => void>>;
	ready: ReturnType<typeof vi.fn<() => void>>;
};
beforeEach(() => {
	vi.useFakeTimers();
	children = [];
	Object.defineProperty(process, "resourcesPath", {
		value: "/Applications/Trackem.app/Contents/Resources",
		configurable: true,
	});
	state.spawn.mockReset().mockImplementation(() => {
		const child = new Child();
		children.push(child);
		return child;
	});
	options = { action: vi.fn(), failed: vi.fn(), ready: vi.fn() };
	host = createMacOSTray(options);
});
afterEach(() => {
	host.stop();
	vi.useRealTimers();
});
describe("native helper supervision", () => {
	it("starts the bundled binary without a shell or provider environment", () => {
		expect(state.spawn.mock.calls[0]?.[0]).toBe(
			"/Applications/Trackem.app/Contents/Frameworks/TrackemTray.app/Contents/MacOS/TrackemTray",
		);
		expect(state.spawn.mock.calls[0]?.[2]).toEqual({
			stdio: ["pipe", "pipe", "pipe"],
			env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "en_US.UTF-8" },
		});
	});
	it("waits for ready and handles split lines before routing actions", () => {
		const child = childAt();
		const write = vi.spyOn(child.stdin, "write");
		host.update(payload);
		expect(write).not.toHaveBeenCalled();
		child.stdout.write('{"version":1,"type":');
		child.stdout.write(
			'"ready"}\n{"version":1,"type":"action","action":"settings"}\n',
		);
		expect(options.ready).toHaveBeenCalledTimes(1);
		expect(options.action).toHaveBeenCalledWith("settings");
		expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
			type: "snapshot",
			accounts: [],
		});
	});
	it("keeps only the latest snapshot while the write pipe is blocked", () => {
		const child = childAt();
		child.stdout.write('{"version":1,"type":"ready"}\n');
		const write = vi.spyOn(child.stdin, "write").mockReturnValue(false);
		host.update(payload);
		host.update(payload);
		host.update({ ...payload, lastCheckedAt: "2026-09-12T10:00:00Z" });
		expect(write).toHaveBeenCalledTimes(1);
		write.mockReturnValue(true);
		child.stdin.emit("drain");
		expect(write).toHaveBeenCalledTimes(2);
		expect(String(write.mock.calls[1]?.[0])).toContain(
			"2026-09-12T10:00:00.000Z",
		);
	});
	it("limits restarts, including failures after a successful handshake", async () => {
		for (let i = 0; i < 4; i++) {
			childAt(i).stdout.write('{"version":1,"type":"ready"}\n');
			childAt(i).emit("exit", 1);
			await vi.advanceTimersByTimeAsync(10_000);
		}
		expect(children).toHaveLength(4);
		expect(options.failed).toHaveBeenCalledTimes(4);
	});
	it("times out a hung handshake and kills malformed helpers", async () => {
		await vi.advanceTimersByTimeAsync(10_000);
		expect(children[0]?.kill).toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		childAt(1).stdout.write('{"version":1,"type":"action","action":"exec"}\n');
		expect(children[1]?.kill).toHaveBeenCalled();
		expect(options.action).not.toHaveBeenCalled();
	});
	it("stops the helper and pending retries on shutdown", async () => {
		childAt().emit("error", new Error("spawn failed"));
		host.stop();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(children).toHaveLength(1);
		expect(children[0]?.stdin.writableEnded).toBe(true);
	});
});
