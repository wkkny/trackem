import { describe, expect, it } from 'vitest';
import { bestSnapshot, collectResetExpiryNotifications, createQueuedSingleFlight } from './app-logic';
import type { TrackemConfig, UsageSnapshot } from './contracts';

function snapshot(id: string, weekly?: number, fiveHour?: number): UsageSnapshot {
  return {
    ok: true,
    providerId: 'codex',
    account: { id, label: id, email: null, home: `/tmp/${id}`, isDefault: false },
    plan: null,
    source: `/tmp/${id}/auth.json`,
    updatedAt: '2026-09-12T00:00:00.000Z',
    windows: {
      ...(weekly === undefined ? {} : { weekly: { id: 'weekly' as const, usedPercent: weekly, resetAt: null, windowSeconds: null } }),
      ...(fiveHour === undefined ? {} : { fiveHour: { id: 'fiveHour' as const, usedPercent: fiveHour, resetAt: null, windowSeconds: null } }),
    },
    topModel: null,
    reserve: null,
  };
}

describe('bestSnapshot', () => {
  it('uses the weekly window and falls back to the five-hour window', () => {
    expect(bestSnapshot([snapshot('weekly', 40), snapshot('session', undefined, 20)])?.account.id).toBe('session');
  });

  it('ignores disconnected snapshots without mutating the input', () => {
    const snapshots = [snapshot('first', 30), { ...snapshot('failed', 1), ok: false }, snapshot('last', 10)];
    expect(bestSnapshot(snapshots)?.account.id).toBe('last');
    expect(snapshots.map((item) => item.account.id)).toEqual(['first', 'failed', 'last']);
  });
});

describe('createQueuedSingleFlight', () => {
  it('deduplicates concurrent work and permits one queued refresh', async () => {
    const resolvers: Array<() => void> = [];
    const task = createQueuedSingleFlight(() => new Promise<void>((resolve) => resolvers.push(resolve)));

    const first = task();
    const duplicate = task();
    const queued = task(true);
    expect(first).toBe(duplicate);
    expect(first).not.toBe(queued);
    expect(resolvers).toHaveLength(1);

    resolvers[0]?.();
    await first;
    await Promise.resolve();
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.();
    await queued;
  });

  it('runs queued work after the active task rejects', async () => {
    let calls = 0;
    const task = createQueuedSingleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first run failed');
    });

    const first = task();
    const queued = task(true);
    await expect(first).rejects.toThrow('first run failed');
    await expect(queued).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe('collectResetExpiryNotifications', () => {
  const config: TrackemConfig = { codexProfileHomes: [], notifyOnResetExpiry: true, resetExpiryDays: 7 };
  const now = Date.parse('2026-09-12T00:00:00.000Z');

  it('deduplicates active notifications and prunes expired keys', () => {
    const item = snapshot('account');
    item.reserve = {
      available: 2,
      nextExpiresAt: '2026-09-14T00:00:00.000Z',
      expirations: ['2026-09-14T00:00:00.000Z'],
      balance: null,
      unit: 'credits',
    };
    const sent = new Set(['old|2026-09-11T00:00:00.000Z']);

    expect(collectResetExpiryNotifications([item], config, sent, now)).toHaveLength(1);
    expect(collectResetExpiryNotifications([item], config, sent, now)).toHaveLength(0);
    expect(sent.has('old|2026-09-11T00:00:00.000Z')).toBe(false);
  });

  it('clears notification history when notifications are disabled', () => {
    const sent = new Set(['account|2026-09-14T00:00:00.000Z']);
    expect(collectResetExpiryNotifications([], { ...config, notifyOnResetExpiry: false }, sent, now)).toEqual([]);
    expect(sent.size).toBe(0);
  });
});
