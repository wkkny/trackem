import { describe, expect, it } from 'vitest';
import { forecastUsage, type Observation } from './forecast';

const now = Date.parse('2026-09-12T12:00:00Z');
const resetAt = new Date(now + 60 * 60_000).toISOString();
const samples = (usage: number[]): Observation[] => usage.map((used, i) => ({ used, at: now - (usage.length - 1 - i) * 5 * 60_000, resetAt }));
describe('observed usage forecasts', () => {
  it('requires observations spanning ten minutes, not a single percentage', () => {
    expect(forecastUsage(samples([70]), now).status).toBe('collecting');
    expect(forecastUsage(samples([50, 70]), now).status).toBe('collecting');
    expect(forecastUsage(samples([20, 30, 40]).map(s => ({ ...s, at: now - (now - s.at) / 10 })), now).status).toBe('collecting');
  });
  it('predicts exhaustion and distinguishes lasting through reset', () => {
    expect(forecastUsage(samples([50, 60, 70]), now)).toMatchObject({ status: 'depleting', runsOutAt: new Date(now + 15 * 60_000).toISOString(), sampleMinutes: 10 });
    expect(forecastUsage(samples([10, 11, 12]), now)).toMatchObject({ status: 'lasts', runsOutAt: null });
  });
  it('does not promise unlimited use when idle', () => {
    expect(forecastUsage(samples([40, 40, 40]), now)).toMatchObject({ status: 'idle', runsOutAt: null });
  });
  it('discards history across quota resets and provider corrections', () => {
    const reset = samples([40, 50, 60]);
    reset[2]!.resetAt = new Date(now + 5 * 60 * 60_000).toISOString();
    expect(forecastUsage(reset, now).status).toBe('collecting');
    expect(forecastUsage(samples([80, 90, 20]), now).status).toBe('collecting');
  });
  it('rejects expired, missing-reset, future, and stale observations', () => {
    expect(forecastUsage(samples([50, 60, 70]), now + 16 * 60_000).status).toBe('stale');
    expect(forecastUsage(samples([50, 60, 70]).map(s => ({ ...s, resetAt: new Date(now).toISOString() })), now).status).toBe('stale');
    expect(forecastUsage(samples([50, 60, 70]).map(s => ({ ...s, resetAt: null })), now).status).toBe('collecting');
    expect(forecastUsage(samples([50, 60, 70]), now - 60_000).status).toBe('stale');
  });
  it('requires new observations after a long offline gap', () => {
    const data = samples([40, 50, 60]);
    data[0]!.at -= 60 * 60_000; data[1]!.at -= 60 * 60_000;
    expect(forecastUsage(data, now).status).toBe('collecting');
  });
  it('reports exhaustion without projecting zero minutes from a fake rate', () => {
    expect(forecastUsage(samples([100]), now).status).toBe('exhausted');
  });
});
