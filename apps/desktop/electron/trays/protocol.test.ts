import { describe, expect, it } from "vitest";
import type { UsageSnapshot, UsageSnapshotPayload } from "@trackem/contracts";
import {
	ACTIONS,
	MAX_LINE_BYTES,
	nativeSnapshot,
	parseNativeEvent,
} from "./protocol";

const snapshot: UsageSnapshot = {
	ok: true,
	providerId: "codex",
	account: {
		id: "secret-account",
		label: "private@example.com",
		email: "private@example.com",
		home: "/private/profile",
		isDefault: true,
	},
	plan: "plus",
	source: "/private/auth.json",
	updatedAt: "2026-09-12T10:00:00.000Z",
	windows: {
		fiveHour: {
			id: "fiveHour",
			usedPercent: 40,
			resetAt: null,
			windowSeconds: 18000,
		},
	},
	reserve: null,
	topModel: "private-model",
};
const payload: UsageSnapshotPayload = {
	codex: [snapshot],
	claude: [],
	diagnostics: [],
	lastCheckedAt: snapshot.updatedAt,
	appVersion: "0.1.0",
};

describe("native display protocol", () => {
	it("sends only allowlisted display fields, not account identity or paths", () => {
		const wire = nativeSnapshot(payload);
		expect(wire.accounts[0]).toMatchObject({
			id: "codex:0",
			label: "Codex",
			available: true,
			windows: [{ usedPercent: 40 }],
		});
		const text = JSON.stringify(wire);
		for (const forbidden of [
			"secret-account",
			"private",
			"home",
			"email",
			"source",
			"topModel",
			"windowSeconds",
			"diagnostics",
		])
			expect(text).not.toContain(forbidden);
		expect(wire.appVersion).toBe("0.1.0");
	});
	it("sanitizes the version sent to the native helper", () => {
		const hostile = nativeSnapshot({
			...payload,
			appVersion: '0.1.0\n"paths":true',
		});
		expect(hostile.appVersion).toBe("0.1.0pathstrue");
		expect(nativeSnapshot({ ...payload, appVersion: "" }).appVersion).toBeNull();
	});
	it("preserves unavailable and disabled states without fake quota", () => {
		const unavailable = nativeSnapshot({
			...payload,
			codex: [
				{
					...snapshot,
					ok: false,
					error: { kind: "auth", message: "sensitive error" },
				},
			],
		});
		expect(unavailable.accounts[0]).toMatchObject({
			available: false,
			windows: [],
		});
		expect(JSON.stringify(unavailable)).not.toContain("sensitive error");
		expect(nativeSnapshot({ ...payload, codex: [] }).accounts).toEqual([]);
	});
	it("drops invalid percentages and bounds the profile count", () => {
		const window = snapshot.windows.fiveHour;
		if (!window) throw new Error("Missing test window");
		const invalid = {
			...snapshot,
			windows: { fiveHour: { ...window, usedPercent: Number.NaN } },
		};
		expect(
			nativeSnapshot({ ...payload, codex: Array(30).fill(invalid) }).accounts,
		).toHaveLength(21);
		expect(
			nativeSnapshot({ ...payload, codex: [invalid] }).accounts[0]?.windows,
		).toEqual([]);
	});
	it("accepts only versioned, allowlisted actions", () => {
		for (const action of ACTIONS)
			expect(
				parseNativeEvent(JSON.stringify({ version: 1, type: "action", action }))
					?.type,
			).toBe("action");
		for (const value of [
			"null",
			"{}",
			"bad json",
			'{"version":2,"type":"ready"}',
			'{"version":1,"type":"action","action":"exec"}',
			"x".repeat(MAX_LINE_BYTES + 1),
		])
			expect(parseNativeEvent(value)).toBeNull();
	});
});
