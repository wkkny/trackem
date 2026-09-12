import { getSnapshots } from "./providers/codex";
import { getClaudeSnapshot } from "./providers/claude";
import { forecastUsage, type Observation } from "@trackem/core/forecast";
import type {
	DiagnosticEntry,
	TrackemConfig,
	UsageSnapshot,
	UsageSnapshotPayload,
} from "@trackem/contracts";

export const REFRESH_INTERVAL_MS = 5 * 60_000;

export function createUsageService(options: {
	getConfig(): TrackemConfig;
	appVersion: string;
	onChange(payload: UsageSnapshotPayload): void;
	onNotify(title: string, body: string): void;
	canNotify(): boolean;
}) {
	let refreshTimer: NodeJS.Timeout | null = null;
	let latestCodexSnapshots: UsageSnapshot[] = [];
	let latestClaudeSnapshots: UsageSnapshot[] = [];
	let suspended = false;
	let quitting = false;
	let inFlight: Promise<void> | null = null;
	let lastAttempt = 0;
	let lastCheckedAt: string | null = null;
	let failures = 0;
	let logSequence = 0;
	const diagnostics: DiagnosticEntry[] = [];
	const history = new Map<string, Observation[]>();
	const sentNotifications = new Map<string, number>();

	function addDiagnostic(
		level: DiagnosticEntry["level"],
		providerId: DiagnosticEntry["providerId"],
		message: string,
		accountLabel: string | null = null,
	): void {
		diagnostics.unshift({
			id: `${Date.now()}-${logSequence++}`,
			level,
			providerId,
			accountLabel,
			message,
			timestamp: new Date().toISOString(),
		});
		if (diagnostics.length > 100) diagnostics.length = 100;
	}
	function payload(): UsageSnapshotPayload {
		return {
			codex: latestCodexSnapshots,
			claude: latestClaudeSnapshots,
			diagnostics: [...diagnostics],
			lastCheckedAt,
			appVersion: options.appVersion,
		};
	}
	function publish(): void {
		options.onChange(payload());
	}

	function notify(
		key: string,
		expires: number,
		title: string,
		body: string,
	): void {
		if (!options.canNotify() || sentNotifications.has(key)) return;
		sentNotifications.set(key, expires);
		options.onNotify(title, body);
	}

	function enrichAndNotify(snapshots: UsageSnapshot[]): void {
		const config = options.getConfig();
		const now = Date.now();
		const activeKeys = new Set<string>();
		for (const [key, expires] of sentNotifications)
			if (expires <= now) sentNotifications.delete(key);
		if (!config.notifyOnLowUsage)
			for (const key of sentNotifications.keys())
				if (!key.startsWith("reset:")) sentNotifications.delete(key);
		if (!config.notifyOnResetExpiry)
			for (const key of sentNotifications.keys())
				if (key.startsWith("reset:")) sentNotifications.delete(key);
		for (const snapshot of snapshots) {
			if (!snapshot.ok) continue;
			const provider = snapshot.providerId === "codex" ? "Codex" : "Claude";
			for (const window of Object.values(snapshot.windows)) {
				const key = `${snapshot.providerId}:${snapshot.account.id}:${window.id}`;
				activeKeys.add(key);
				const samples = history.get(key) ?? [];
				const last = samples.at(-1);
				const observation = {
					at: now,
					used: window.usedPercent,
					resetAt: window.resetAt,
				};
				if (!last || now - last.at >= 60_000) samples.push(observation);
				else samples[samples.length - 1] = observation;
				const recent = samples
					.filter((s) => s.at >= now - 2 * 60 * 60_000)
					.slice(-120);
				history.set(key, recent);
				window.forecast = forecastUsage(recent, now);
				const reset = window.resetAt ? Date.parse(window.resetAt) : NaN;
				const eta = window.forecast.runsOutAt
					? Date.parse(window.forecast.runsOutAt) - now
					: Infinity;
				if (
					config.notifyOnLowUsage &&
					reset > now &&
					(window.usedPercent >= 90 || eta <= 60 * 60_000)
				) {
					notify(
						`${key}:${window.resetAt}`,
						reset,
						`${provider} quota warning`,
						`${window.id === "fiveHour" ? "Session" : "Weekly"} quota: ${Math.round(100 - window.usedPercent)}% left.${eta <= 60 * 60_000 ? " Estimated to run out within an hour at your recent pace." : ""}`,
					);
				}
			}
			const expiry = snapshot.reserve?.nextExpiresAt;
			if (
				config.notifyOnResetExpiry &&
				snapshot.reserve &&
				(snapshot.reserve.available ?? 0) > 0 &&
				expiry
			) {
				const expires = Date.parse(expiry);
				if (
					expires > now &&
					expires - now <= config.resetExpiryDays * 86_400_000
				)
					notify(
						`reset:${snapshot.account.id}:${expiry}`,
						expires,
						"Codex reset expiring soon",
						`A banked reset expires on ${new Date(expiry).toLocaleDateString()}. Open Trackem for details.`,
					);
			}
		}
		for (const key of history.keys())
			if (!activeKeys.has(key)) history.delete(key);
	}

	function scheduleRefresh(): void {
		if (refreshTimer) clearTimeout(refreshTimer);
		if (!suspended && !quitting)
			refreshTimer = setTimeout(
				() => void refreshUsage(),
				Math.min(30 * 60_000, REFRESH_INTERVAL_MS * 2 ** failures),
			);
	}
	function refreshUsage(force = false): Promise<void> {
		if (inFlight) return inFlight;
		if (quitting || suspended || (!force && Date.now() - lastAttempt < 30_000))
			return Promise.resolve();
		lastAttempt = Date.now();
		inFlight = (async () => {
			const config = options.getConfig();
			const [codex, claude] = await Promise.all([
				config.codexEnabled
					? getSnapshots(config.codexProfileHomes, config.scanLocalModels)
					: Promise.resolve([]),
				config.claudeEnabled
					? getClaudeSnapshot(config.claudeHome).then((s) => [s])
					: Promise.resolve([]),
			]);
			if (quitting) return;
			latestCodexSnapshots = codex;
			latestClaudeSnapshots = claude;
			const all = [...codex, ...claude];
			lastCheckedAt = new Date().toISOString();
			failures =
				all.length && all.every((s) => !s.ok) ? Math.min(failures + 1, 3) : 0;
			for (const snapshot of all)
				addDiagnostic(
					snapshot.ok ? "info" : "error",
					snapshot.providerId,
					snapshot.ok
						? `Quota refreshed in ${Date.now() - lastAttempt} ms`
						: (snapshot.error?.message ?? "Quota refresh failed"),
					snapshot.account.label,
				);
			enrichAndNotify(all);
			publish();
		})()
			.catch(() => {
				if (!quitting) {
					addDiagnostic("error", "system", "Usage refresh failed");
					failures = Math.min(failures + 1, 3);
					publish();
				}
			})
			.finally(() => {
				inFlight = null;
				scheduleRefresh();
			});
		return inFlight;
	}

	return {
		payload,
		refresh: refreshUsage,
		addDiagnostic,
		idle: () => inFlight,
		clearHistory: () => history.clear(),
		opened: () => {
			if (Date.now() - lastAttempt > REFRESH_INTERVAL_MS) void refreshUsage();
		},
		suspend: () => {
			suspended = true;
			if (refreshTimer) clearTimeout(refreshTimer);
		},
		resume: () => {
			suspended = false;
			history.clear();
			void refreshUsage(true);
		},
		stop: () => {
			quitting = true;
			if (refreshTimer) clearTimeout(refreshTimer);
		},
	};
}
