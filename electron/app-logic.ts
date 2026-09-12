import type { TrackemConfig, UsageSnapshot } from './contracts';

export interface ResetExpiryNotification {
  key: string;
  title: string;
  body: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createQueuedSingleFlight(task: () => Promise<void>): (queueAfterCurrent?: boolean) => Promise<void> {
  let current: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  return (queueAfterCurrent = false): Promise<void> => {
    if (!current) {
      const run = task().finally(() => {
        if (current === run) current = null;
      });
      current = run;
      return run;
    }

    if (!queueAfterCurrent) return current;
    if (queued) return queued;

    const preceding = current;
    const run = preceding.catch(() => undefined).then(task).finally(() => {
      if (current === run) current = null;
      if (queued === run) queued = null;
    });
    current = run;
    queued = run;
    return run;
  };
}

export function bestSnapshot(snapshots: UsageSnapshot[]): UsageSnapshot | null {
  let best: UsageSnapshot | null = null;
  let bestUsed = Number.POSITIVE_INFINITY;

  for (const snapshot of snapshots) {
    if (!snapshot.ok) continue;
    const used = snapshot.windows.weekly?.usedPercent ?? snapshot.windows.fiveHour?.usedPercent;
    if (used !== undefined && used < bestUsed) {
      best = snapshot;
      bestUsed = used;
    } else if (!best && used === undefined) {
      best = snapshot;
    }
  }

  return best;
}

export function collectResetExpiryNotifications(
  snapshots: UsageSnapshot[],
  config: TrackemConfig,
  sent: Set<string>,
  now = Date.now(),
): ResetExpiryNotification[] {
  if (!config.notifyOnResetExpiry) {
    sent.clear();
    return [];
  }

  for (const key of sent) {
    const expiry = Date.parse(key.slice(key.indexOf('|') + 1));
    if (!Number.isFinite(expiry) || expiry <= now) sent.delete(key);
  }

  const threshold = config.resetExpiryDays * DAY_MS;
  const notifications: ResetExpiryNotification[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot.ok || !snapshot.reserve || snapshot.reserve.available <= 0) continue;
    const expiry = snapshot.reserve.nextExpiresAt;
    if (!expiry) continue;
    const remaining = Date.parse(expiry) - now;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > threshold) continue;

    const key = `${snapshot.account.id}|${expiry}`;
    if (sent.has(key)) continue;
    sent.add(key);
    const days = Math.max(1, Math.ceil(remaining / DAY_MS));
    notifications.push({
      key,
      title: 'Codex reset expiring soon',
      body: `${snapshot.account.label} has ${snapshot.reserve.available} banked reset${snapshot.reserve.available === 1 ? '' : 's'}; the next expires in ${days} day${days === 1 ? '' : 's'}.`,
    });
  }
  return notifications;
}
