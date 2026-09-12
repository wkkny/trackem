import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UsageSnapshot, UsageWindow } from '../codex';

const execFileAsync = promisify(execFile);
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function mapClaudeWindows(value: unknown): UsageSnapshot['windows'] {
  const data = record(value);
  const windows: UsageSnapshot['windows'] = {};
  for (const [key, id, seconds] of [['five_hour', 'fiveHour', 18_000], ['seven_day', 'weekly', 604_800]] as const) {
    const window = record(data[key]);
    if (typeof window.utilization !== 'number' || !Number.isFinite(window.utilization) || window.utilization < 0 || window.utilization > 100) continue;
    const reset = typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN;
    windows[id] = { id, usedPercent: window.utilization, resetAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null, windowSeconds: seconds } satisfies UsageWindow;
  }
  return windows;
}

/** Claude Code owns credentials. Never refresh tokens, read browser cookies, or accept API keys as subscription quotas. */
export async function getClaudeSnapshot(configuredHome = ''): Promise<UsageSnapshot> {
  const home = path.resolve(configuredHome || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const file = path.join(home, '.credentials.json');
  const base: UsageSnapshot = {
    ok: false, providerId: 'claude',
    account: { id: createHash('sha256').update(`claude:${home}`).digest('hex').slice(0, 12), label: 'Claude Code', email: null, home, isDefault: !configuredHome },
    source: file, updatedAt: new Date().toISOString(), plan: null, windows: {}, topModel: null, reserve: null,
  };
  const failure = (kind: string, message: string): UsageSnapshot => ({ ...base, error: { kind, message } });
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    if (process.platform !== 'darwin' || configuredHome || process.env.CLAUDE_CONFIG_DIR) {
      return failure('missing-credential', 'No Claude Code credentials found. Sign in with `claude`, then refresh. For WSL, set the Claude directory in Settings.');
    }
    try {
      const result = await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 1024 * 1024 });
      raw = result.stdout;
      base.source = 'macOS Keychain: Claude Code-credentials';
    } catch {
      return failure('missing-credential', 'Sign in with `claude` first. Trackem reads the Claude Code credential file or its macOS Keychain entry.');
    }
  }
  let auth: Record<string, unknown>;
  try { auth = record(record(JSON.parse(raw)).claudeAiOauth); }
  catch { return failure('malformed-credential', 'Claude Code credentials are not valid JSON. Sign in again with `claude`.'); }
  if (typeof auth.accessToken !== 'string' || !auth.accessToken) return failure('missing-credential', 'Claude Code OAuth login is required. API keys do not expose subscription quotas.');
  if (typeof auth.expiresAt === 'number' && auth.expiresAt <= Date.now()) return failure('authentication-expired', 'Claude Code login expired. Open `claude` to renew it, then refresh Trackem.');
  try {
    const response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) return failure('authentication-expired', 'Claude rejected this login or its permissions. Sign in again with `claude`.');
    if (response.status === 429) return failure('api-failure', 'Claude rate-limited usage checks. Trackem will retry on its next background refresh.');
    if (!response.ok) return failure('api-failure', `Claude usage API returned HTTP ${response.status}. Try again later.`);
    let data: unknown;
    try { data = await response.json(); } catch { return failure('parse-failure', 'Claude returned an unreadable usage response.'); }
    const windows = mapClaudeWindows(data);
    if (!Object.keys(windows).length) return failure('parse-failure', 'Claude did not provide supported subscription quota windows.');
    return { ...base, ok: true, windows, updatedAt: new Date().toISOString(), plan: typeof auth.subscriptionType === 'string' ? auth.subscriptionType : null };
  } catch {
    return failure('network-failure', 'Could not reach Claude within 10 seconds. Check your connection and try again.');
  }
}
