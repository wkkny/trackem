import { describe, expect, it } from 'vitest';
import { computePace, formatDuration, percentLeft } from './usage';

describe('computePace', () => {
  const now = new Date('2026-09-12T12:00:00Z').getTime();

  it('reports ahead-of-pace usage that lasts until reset', () => {
    const result = computePace(20, '2026-09-12T14:30:00Z', 5 * 60 * 60, now);
    expect(result).not.toBeNull();
    expect(result?.expected).toBe(50);
    expect(result?.reserve).toBe(30);
    expect(result?.willLast).toBe(true);
  });

  it('projects a run-out for usage above the burn line', () => {
    const result = computePace(80, '2026-09-12T14:30:00Z', 5 * 60 * 60, now);
    expect(result?.willLast).toBe(false);
    expect(result?.etaSeconds).toBe(2250);
  });

  it('rejects elapsed and invalid windows', () => {
    expect(computePace(10, null, 3600, now)).toBeNull();
    expect(computePace(10, '2026-09-12T11:00:00Z', 3600, now)).toBeNull();
    expect(computePace(10, '2026-09-12T13:00:00Z', 0, now)).toBeNull();
  });
});

describe('usage formatting', () => {
  it('formats durations without zero-value units', () => {
    expect(formatDuration(90 * 60, 'hours')).toBe('1h 30m');
    expect(formatDuration(49 * 60 * 60, 'days')).toBe('2d 1h');
  });

  it('clamps percentages left', () => {
    expect(percentLeft(15.4)).toBe(85);
    expect(percentLeft(-10)).toBe(100);
    expect(percentLeft(120)).toBe(0);
  });
});
