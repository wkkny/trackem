import type { UsageSnapshot, UsageSnapshotPayload } from "@trackem/contracts";

export const PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 256 * 1024;
export const ACTIONS = [
	"dashboard",
	"settings",
	"refresh",
	"quit",
	"opened",
] as const;
export type NativeAction = (typeof ACTIONS)[number];
export type NativeEvent =
	| { version: 1; type: "ready" }
	| { version: 1; type: "action"; action: NativeAction };

const label = (value: string) =>
	Array.from(value)
		.slice(0, 160)
		.map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
		.join("");
const date = (value: string | null) =>
	value && Number.isFinite(Date.parse(value))
		? new Date(value).toISOString()
		: null;
/** Only a short version string crosses to the native helper, nothing descriptive. */
const appVersion = (value: string | undefined) => {
	const safe = (value ?? "").replace(/[^0-9A-Za-z.+-]/g, "").slice(0, 20);
	return safe ? safe : null;
};

/** Construct an allowlisted display DTO. Never spread a provider or account object here. */
export function nativeSnapshot(payload: UsageSnapshotPayload) {
	const account = (s: UsageSnapshot, index: number) => ({
		// Stable per-provider position, never an account ID, email, credential path or source.
		id: `${s.providerId}:${index}`,
		provider: s.providerId,
		label: label(
			s.account.isDefault
				? s.providerId === "codex"
					? "Codex"
					: "Claude"
				: `Codex profile ${index + 1}`,
		),
		plan: s.plan ? label(s.plan) : null,
		available: s.ok,
		updatedAt: date(s.updatedAt),
		windows: s.ok
			? Object.values(s.windows)
					.filter(
						(w) =>
							Number.isFinite(w.usedPercent) &&
							w.usedPercent >= 0 &&
							w.usedPercent <= 100,
					)
					.map((w) => ({
						id: w.id,
						usedPercent: w.usedPercent,
						resetAt: date(w.resetAt),
					}))
			: [],
		bankedResets:
			s.ok &&
			s.reserve?.available != null &&
			Number.isSafeInteger(s.reserve.available) &&
			s.reserve.available >= 0
				? s.reserve.available
				: null,
		// No arbitrary error messages cross this boundary.
		status: s.ok
			? "Provider-reported subscription usage"
			: "Usage unavailable. Check provider access in Settings.",
	});
	return {
		version: PROTOCOL_VERSION,
		type: "snapshot" as const,
		checkedAt: date(payload.lastCheckedAt),
		appVersion: appVersion(payload.appVersion),
		accounts: [
			...payload.codex.slice(0, 21).map(account),
			...payload.claude.slice(0, 1).map(account),
		],
	};
}

export function parseNativeEvent(line: string): NativeEvent | null {
	if (Buffer.byteLength(line) > MAX_LINE_BYTES) return null;
	try {
		const value: unknown = JSON.parse(line);
		if (
			!value ||
			typeof value !== "object" ||
			!("version" in value) ||
			value.version !== 1 ||
			!("type" in value)
		)
			return null;
		if (value.type === "ready") return { version: 1, type: "ready" };
		if (
			value.type === "action" &&
			"action" in value &&
			ACTIONS.some((action) => action === value.action)
		) {
			return {
				version: 1,
				type: "action",
				action: value.action as NativeAction,
			};
		}
	} catch {
		/* Treat malformed helper output as a protocol failure. */
	}
	return null;
}
