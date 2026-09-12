export interface Observation { at: number; used: number; resetAt: string | null }
import type { Forecast } from '@trackem/contracts';
export type { Forecast } from '@trackem/contracts';
/** Use only recent observations in the same quota window. No inferred start-of-window usage. */
export function forecastUsage(samples: Observation[], now = Date.now()): Forecast {
  const result: Forecast = { status: 'collecting', runsOutAt: null, sampleMinutes: 0 };
  const last = samples.at(-1);
  if (!last || !Number.isFinite(last.used)) return result;
  const reset = last.resetAt ? Date.parse(last.resetAt) : NaN;
  if (now - last.at > 15 * 60_000 || last.at > now || reset <= now) return { ...result, status: 'stale' };
  if (last.used >= 100) return { ...result, status: 'exhausted' };
  if (!Number.isFinite(reset)) return result;
  let recent = samples.filter(s => s.resetAt === last.resetAt && s.at >= now - 2 * 60 * 60_000 && s.at <= now);
  // A correction, a usage drop, or a long offline gap starts a new observation period.
  for (let i = recent.length - 1; i > 0; i--) {
    const current = recent[i];
    const previous = recent[i - 1];
    if (current && previous && (current.used < previous.used || current.at - previous.at > 15 * 60_000)) {
      recent = recent.slice(i);
      break;
    }
  }
  const first = recent[0];
  if (!first) return result;
  result.sampleMinutes = (last.at - first.at) / 60_000;
  if (recent.length < 3 || result.sampleMinutes < 10) return result;
  const delta = last.used - first.used;
  if (delta <= 0) return { ...result, status: 'idle' };
  const runsOut = last.at + (100 - last.used) / delta * (last.at - first.at);
  if (!Number.isFinite(runsOut)) return result;
  return { ...result, status: runsOut < reset ? 'depleting' : 'lasts', runsOutAt: runsOut < reset ? new Date(runsOut).toISOString() : null };
}
