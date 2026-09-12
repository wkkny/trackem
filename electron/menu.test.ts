import { describe, expect, it } from 'vitest';
import { formatPlan, formatReset, percentLeft, usageLabels } from './menu';
import type { UsageSnapshot } from './providers/codex';

describe('native tray labels', () => {
  it('formats plan names and remaining usage', () => {
    expect(formatPlan('chatgpt_plus')).toBe('Chatgpt Plus');
    expect(percentLeft(12.4)).toBe(88);
  });

  it('formats five-hour resets in hours and weekly resets in days', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(formatReset('2026-01-01T02:05:00.000Z', 'fiveHour', now)).toBe('2h 5m');
    expect(formatReset('2026-01-04T05:00:00.000Z', 'weekly', now)).toBe('3d 5h');
    expect(formatReset('2026-01-01T00:30:00.000Z', 'weekly', now)).toBe('30m');
  });

  it('includes the plan, quota windows, and banked resets', () => {
    const snapshot: UsageSnapshot = {
      ok: true,
      plan: 'plus',
      updatedAt: '2026-01-01T00:00:00.000Z',
      windows: {
        fiveHour: { id: 'fiveHour', usedPercent: 12, resetAt: '2026-01-01T02:00:00.000Z', windowSeconds: 18_000 },
        weekly: { id: 'weekly', usedPercent: 34, resetAt: '2026-01-04T00:00:00.000Z', windowSeconds: 604_800 },
      },
      bankedResets: 2,
    };

    expect(usageLabels(snapshot, Date.parse('2026-01-01T00:00:00.000Z'))).toEqual([
      'Plan: Plus',
      '5-hour usage: 88% left',
      'Resets in: 2h',
      'Banked resets: 2',
      'Weekly usage: 66% left',
      'Resets in: 3d',
    ]);
  });
});
