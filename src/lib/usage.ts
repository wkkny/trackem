export interface PaceMetrics {
  expected: number;
  reserve: number;
  willLast: boolean;
  multiplier: number | null;
  etaSeconds: number | null;
}

export function computePace(
  usedPercent: number,
  resetAt: string | null,
  windowSeconds: number | null,
  now = Date.now(),
): PaceMetrics | null {
  if (!resetAt || !windowSeconds || windowSeconds <= 0) return null;
  const timeUntil = (new Date(resetAt).getTime() - now) / 1000;
  if (!Number.isFinite(timeUntil) || timeUntil <= 0 || timeUntil > windowSeconds) return null;
  const elapsed = windowSeconds - timeUntil;
  if (elapsed <= 0) return null;

  const expected = Math.min(Math.max((elapsed / windowSeconds) * 100, 0), 100);
  const actual = Math.min(Math.max(usedPercent, 0), 100);
  const remaining = 100 - actual;
  const burnPerSecond = actual / elapsed;
  const projectedRemaining = burnPerSecond > 0 ? burnPerSecond * timeUntil : 0;
  const willLast = burnPerSecond === 0 || remaining / burnPerSecond >= timeUntil;

  return {
    expected,
    reserve: Math.round(expected - actual),
    willLast,
    multiplier: projectedRemaining > 0 && remaining > 0 ? remaining / projectedRemaining : null,
    etaSeconds: !willLast && burnPerSecond > 0 ? remaining / burnPerSecond : null,
  };
}

export function formatDuration(seconds: number, style: 'hours' | 'days'): string {
  if (style === 'hours') {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const totalHours = Math.max(1, Math.round(seconds / 3600));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `${hours}h`;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function percentLeft(usedPercent: number): number {
  return Math.round(Math.min(100, Math.max(0, 100 - usedPercent)));
}
