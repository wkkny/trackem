import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSnapshot, isTokenExpired, mapWindow } from './index';

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

function usageRequestCount(): number {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/wham/usage')).length;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    void input;
    return usageResponse();
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('Codex account', () => {
  it('fetches the default account snapshot', async () => {
    createAuthenticatedHome();
    const snapshot = await getSnapshot();
    expect(snapshot).toMatchObject({ ok: true, plan: 'plus' });
  });

  it('distinguishes valid JSON without quota windows from a non-JSON response', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-invalid-usage-'));
    directories.push(home);
    process.env.CODEX_HOME = home;
    writeAuth(home, 'personal@example.com', 'account-one');

    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
    expect((await getSnapshot()).error?.message).toBe('Codex did not provide supported quota windows.');

    vi.mocked(fetch).mockResolvedValueOnce(new Response('not json'));
    expect((await getSnapshot()).error?.message).toBe('Codex usage API returned a non-JSON response.');
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

describe('Codex requests', () => {
  it.each([401, 403])('maps HTTP %i to an expired credential without retrying', async (status) => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status }));

    const snapshot = await getSnapshot();

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'authentication-expired' },
    });
    expect(usageRequestCount()).toBe(1);
  });

  it('reports malformed JSON from a successful usage response', async () => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockResolvedValue(new Response('not JSON', { status: 200 }));

    const snapshot = await getSnapshot();

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'parse-failure' },
    });
    expect(usageRequestCount()).toBe(1);
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

    const snapshotPromise = getSnapshot();
    await vi.advanceTimersByTimeAsync(250);
    const snapshot = await snapshotPromise;

    expect(snapshot).toMatchObject({ ok: true, plan: 'plus' });
    expect(usageAttempts).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a 5xx response once and then succeeds', async () => {
    createAuthenticatedHome();
    let usageAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (!String(input).endsWith('/wham/usage')) {
        return new Response(JSON.stringify({ available_count: 1 }), { status: 200 });
      }
      usageAttempts += 1;
      if (usageAttempts === 1) {
        return new Response('unavailable', { status: 503, headers: { 'Retry-After': '0' } });
      }
      return usageResponse();
    });

    const snapshot = await getSnapshot();

    expect(snapshot.ok).toBe(true);
    expect(usageAttempts).toBe(2);
  });

  it('reports the number of available banked resets', async () => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/wham/usage')) return usageResponse();
      return new Response(JSON.stringify({ available_count: 3 }), { status: 200 });
    });

    expect(await getSnapshot()).toMatchObject({ ok: true, bankedResets: 3 });
  });

  it('starts the reset request while the usage request is pending', async () => {
    createAuthenticatedHome();
    let resolveUsage: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).endsWith('/wham/usage')) {
        return new Promise<Response>(resolve => {
          resolveUsage = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ available_count: 1 }), { status: 200 }));
    });

    const snapshotPromise = getSnapshot();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    resolveUsage?.(usageResponse());
    expect(await snapshotPromise).toMatchObject({ ok: true, bankedResets: 1 });
  });

  it('excludes credits marked as redeemed without a redeemed timestamp', async () => {
    createAuthenticatedHome();
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/wham/usage')) return usageResponse();
      return new Response(JSON.stringify({
        credits: [
          { status: 'redeemed', expires_at: '2999-01-01T00:00:00.000Z', redeemed_at: null },
          { status: 'available', expires_at: '2999-01-02T00:00:00.000Z', redeemed_at: null },
        ],
      }), { status: 200 });
    });

    expect(await getSnapshot()).toMatchObject({ ok: true, bankedResets: 1 });
  });

  it('retries timed-out requests once and clears both attempt timers', async () => {
    createAuthenticatedHome();
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));

    const snapshotPromise = getSnapshot();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(usageRequestCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(usageRequestCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = await snapshotPromise;

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

    const snapshotPromise = getSnapshot();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = await snapshotPromise;

    expect(snapshot).toMatchObject({
      ok: false,
      error: { kind: 'network-failure', message: expect.stringContaining('timed out') },
    });
    expect(usageRequestCount()).toBe(2);
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

    const snapshotPromise = getSnapshot();
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = await snapshotPromise;

    expect(snapshot.error?.kind).toBe('authentication-expired');
    expect(usageRequestCount()).toBe(1);
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

    const snapshotPromise = getSnapshot();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(usageAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const snapshot = await snapshotPromise;

    expect(snapshot.ok).toBe(true);
    expect(usageAttempts).toBe(2);
  });

  it('does not expose the access token in API errors or retry ordinary 4xx responses', async () => {
    const home = createAuthenticatedHome();
    const accessToken = 'secret-access-token';
    writeAuth(home, 'person@example.com', 'account-one', accessToken);
    vi.mocked(fetch).mockResolvedValue(new Response(`invalid token ${accessToken}`, { status: 400 }));

    const snapshot = await getSnapshot();

    expect(snapshot.error?.message).toContain('HTTP 400');
    expect(snapshot.error?.message).not.toContain(accessToken);
    expect(usageRequestCount()).toBe(1);
  });

});
