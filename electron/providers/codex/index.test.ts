import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverProfiles, getSnapshots, isTokenExpired, mapWindow } from './index';

const directories: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function writeAuth(home: string, email: string, accountId: string): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({
    tokens: {
      access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      id_token: jwt({ email }),
      account_id: accountId,
    },
  }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/wham/usage')) {
      return new Response(JSON.stringify({
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 12, reset_at: 2_000_000_000, limit_window_seconds: 18_000 },
          secondary_window: { used_percent: 34, reset_at: 2_000_010_000, limit_window_seconds: 604_800 },
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ available_count: 2, credits: [] }), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('Codex profiles', () => {
  it('deduplicates the default and configured homes', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-profile-'));
    directories.push(home);
    process.env.CODEX_HOME = home;
    expect(discoverProfiles([home, path.join(home, 'other')])).toEqual([
      { home: path.resolve(home), isDefault: true },
      { home: path.resolve(home, 'other'), isDefault: false },
    ]);
  });

  it('fetches independent account snapshots and preserves missing-profile errors', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-default-'));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-second-'));
    const missing = path.join(os.tmpdir(), `trackem-missing-${Date.now()}`);
    directories.push(home, second);
    process.env.CODEX_HOME = home;
    writeAuth(home, 'personal@example.com', 'account-one');
    writeAuth(second, 'work@example.com', 'account-two');

    const snapshots = await getSnapshots([second, missing]);
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toMatchObject({ ok: true, plan: 'plus', account: { label: 'personal@example.com', isDefault: true } });
    expect(snapshots[1]).toMatchObject({ ok: true, account: { label: 'work@example.com', isDefault: false } });
    expect(snapshots[2]).toMatchObject({ ok: false, error: { kind: 'missing-credential' } });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('Codex normalization', () => {
  it('detects expiry and tolerates malformed JWTs', () => {
    expect(isTokenExpired(jwt({ exp: 10 }), 11_000)).toBe(true);
    expect(isTokenExpired(jwt({ exp: 20 }), 11_000)).toBe(false);
    expect(isTokenExpired('not-a-jwt', 11_000)).toBe(false);
  });

  it('rejects invalid percentages instead of displaying invented boundaries', () => {
    expect(mapWindow({ used_percent: 130 }, 'weekly')).toBeNull();
    expect(mapWindow({ used_percent: -3 }, 'fiveHour')).toBeNull();
    expect(mapWindow({ used_percent: Number.NaN }, 'weekly')).toBeNull();
    expect(mapWindow({ used_percent: 40, reset_at: 1e20 }, 'weekly')?.resetAt).toBeNull();
  });
});
