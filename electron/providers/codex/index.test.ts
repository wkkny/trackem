import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverProfiles, getSnapshots, isTokenExpired, mapWindow, type UsageSnapshot } from './index';

const directories: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function writeAuth(home: string, email: string, accountId: string, accessToken = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 })): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({
    tokens: {
      access_token: accessToken,
      id_token: jwt({ email }),
      account_id: accountId,
    },
  }));
}

function createAuthenticatedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-codex-'));
  directories.push(home);
  process.env.CODEX_HOME = home;
  writeAuth(home, 'person@example.com', 'account-one');
  return home;
}

function usageResponse(): Response {
  return new Response(JSON.stringify({
    plan_type: 'plus',
    rate_limit: {
      primary_window: { used_percent: 12, reset_at: 2_000_000_000, limit_window_seconds: 18_000 },
      secondary_window: { used_percent: 34, reset_at: 2_000_010_000, limit_window_seconds: 604_800 },
    },
  }), { status: 200 });
}

function firstSnapshot(snapshots: UsageSnapshot[]): UsageSnapshot {
  const snapshot = snapshots[0];
  if (!snapshot) throw new Error('Expected one Codex snapshot');
  return snapshot;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/wham/usage')) return usageResponse();
    return new Response(JSON.stringify({ available_count: 2, credits: [] }), { status: 200 });
  }));
});

afterEach(() => {
  vi.useRealTimers();
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

  it('clamps percentages and rejects non-finite data', () => {
    expect(mapWindow({ used_percent: 130 }, 'weekly')?.usedPercent).toBe(100);
    expect(mapWindow({ used_percent: -3 }, 'fiveHour')?.usedPercent).toBe(0);
    expect(mapWindow({ used_percent: Number.NaN }, 'weekly')).toBeNull();
  });
});

describe('Codex requests', () => {
  it.each([401, 403])('maps HTTP %i to an expired credential without retrying', async (status) => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status }));

    const snapshot = firstSnapshot(await getSnapshots());

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'authentication-expired' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports malformed JSON from a successful usage response', async () => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockResolvedValue(new Response('not JSON', { status: 200 }));

    const snapshot = firstSnapshot(await getSnapshots());

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'parse-failure' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network failure once and then succeeds', async () => {
    createAuthenticatedHome();
    vi.useFakeTimers();
    let usageAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/wham/usage')) {
        usageAttempts += 1;
        if (usageAttempts === 1) throw new TypeError('fetch failed');
        return usageResponse();
      }
      return new Response(JSON.stringify({ available_count: 0, credits: [] }), { status: 200 });
    });

    const snapshotsPromise = getSnapshots();
    await vi.advanceTimersByTimeAsync(250);
    const snapshot = firstSnapshot(await snapshotsPromise);

    expect(snapshot).toMatchObject({ ok: true, plan: 'plus' });
    expect(usageAttempts).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a 5xx response once and then succeeds', async () => {
    createAuthenticatedHome();
    let usageAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/wham/usage')) {
        usageAttempts += 1;
        if (usageAttempts === 1) {
          return new Response('unavailable', { status: 503, headers: { 'Retry-After': '0' } });
        }
        return usageResponse();
      }
      return new Response('{}', { status: 200 });
    });

    const snapshot = firstSnapshot(await getSnapshots());

    expect(snapshot.ok).toBe(true);
    expect(usageAttempts).toBe(2);
  });

  it('retries timed-out requests once and clears both attempt timers', async () => {
    createAuthenticatedHome();
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));

    const snapshotsPromise = getSnapshots();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = firstSnapshot(await snapshotsPromise);

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'network-failure', message: expect.stringContaining('timed out') },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out and retries when the response body stalls after headers', async () => {
    createAuthenticatedHome();
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(stream, { status: 200 });
    });

    const snapshotsPromise = getSnapshots();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = firstSnapshot(await snapshotsPromise);

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'network-failure', message: expect.stringContaining('timed out') },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry or misclassify an auth response with a stalled body', async () => {
    createAuthenticatedHome();
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(stream, { status: 401 });
    });

    const snapshotsPromise = getSnapshots();
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = firstSnapshot(await snapshotsPromise);

    expect(snapshot.error?.kind).toBe('authentication-expired');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps Retry-After before retrying a rate-limited request', async () => {
    createAuthenticatedHome();
    vi.useFakeTimers();
    let usageAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/wham/usage')) {
        usageAttempts += 1;
        if (usageAttempts === 1) return new Response('rate limited', { status: 429, headers: { 'Retry-After': '120' } });
        return usageResponse();
      }
      return new Response('{}', { status: 200 });
    });

    const snapshotsPromise = getSnapshots();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(usageAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const snapshot = firstSnapshot(await snapshotsPromise);

    expect(snapshot.ok).toBe(true);
    expect(usageAttempts).toBe(2);
  });

  it('redacts the access token from API errors and does not retry ordinary 4xx responses', async () => {
    const home = createAuthenticatedHome();
    const accessToken = 'secret-access-token';
    writeAuth(home, 'person@example.com', 'account-one', accessToken);
    vi.mocked(fetch).mockResolvedValue(new Response(`invalid token ${accessToken}`, { status: 400 }));

    const snapshot = firstSnapshot(await getSnapshots());

    expect(snapshot.error?.message).toContain('[redacted]');
    expect(snapshot.error?.message).not.toContain(accessToken);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('filters redeemed, expired, and elapsed reset credits', async () => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/wham/usage')) return usageResponse();
      return new Response(JSON.stringify({
        credits: [
          { status: 'available', expires_at: '2999-01-02T00:00:00.000Z', redeemed_at: null },
          { status: 'available', expires_at: '2999-01-03T00:00:00.000Z', redeemed_at: '2026-01-01T00:00:00.000Z' },
          { status: 'expired', expires_at: '2999-01-04T00:00:00.000Z', redeemed_at: null },
          { status: 'available', expires_at: '2000-01-01T00:00:00.000Z', redeemed_at: null },
        ],
      }), { status: 200 });
    });

    const snapshot = firstSnapshot(await getSnapshots());

    expect(snapshot.reserve).toMatchObject({
      available: 1,
      nextExpiresAt: '2999-01-02T00:00:00.000Z',
      expirations: ['2999-01-02T00:00:00.000Z'],
    });
  });
});
