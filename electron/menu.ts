import type { UsageSnapshot, UsageWindow } from './providers/codex';

export function formatPlan(value: string | null): string {
  if (!value) return 'Unavailable';
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

export function percentLeft(usedPercent: number): number {
  return Math.round(100 - Math.min(100, Math.max(0, usedPercent)));
}

export function formatReset(resetAt: string | null, window: UsageWindow['id'], now = Date.now()): string {
  if (!resetAt) return 'Unavailable';
  const resetTime = Date.parse(resetAt);
  if (!Number.isFinite(resetTime)) return 'Unavailable';
  const seconds = Math.max(0, Math.ceil((resetTime - now) / 1000));
  if (seconds === 0) return 'Now';

  if (window === 'fiveHour') {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    if (hours === 0) return `${Math.max(1, minutes)}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days === 0) return hours === 0 ? `${Math.ceil(seconds / 60)}m` : `${hours}h`;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

export function usageLabels(snapshot: UsageSnapshot, now = Date.now()): string[] {
  if (!snapshot.ok) return ['Codex usage unavailable', snapshot.error?.message ?? 'Try again.'];

  const fiveHour = snapshot.windows.fiveHour;
  const weekly = snapshot.windows.weekly;
  return [
    `Plan: ${formatPlan(snapshot.plan)}`,
    fiveHour ? `5-hour usage: ${percentLeft(fiveHour.usedPercent)}% left` : '5-hour usage: Unavailable',
    fiveHour ? `Resets in: ${formatReset(fiveHour.resetAt, 'fiveHour', now)}` : 'Resets in: Unavailable',
    `Banked resets: ${snapshot.bankedResets ?? 'Unavailable'}`,
    weekly ? `Weekly usage: ${percentLeft(weekly.usedPercent)}% left` : 'Weekly usage: Unavailable',
    weekly ? `Resets in: ${formatReset(weekly.resetAt, 'weekly', now)}` : 'Resets in: Unavailable',
  ];
}
