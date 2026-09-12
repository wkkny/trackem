import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClaudeSnapshot, mapClaudeWindows } from './index';

let home: string;
const token = 'private-oauth-test-token';
const response = { five_hour: { utilization: 42, resets_at: '2026-09-12T15:00:00Z' }, seven_day: { utilization: 65, resets_at: '2026-09-18T15:00:00Z' } };
function auth(value: unknown = { claudeAiOauth: { accessToken: token, subscriptionType: 'max', expiresAt: Date.now() + 60_000 } }) {
  fs.writeFileSync(path.join(home, '.credentials.json'), JSON.stringify(value));
}
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-claude-'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))));
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(home, { recursive: true, force: true }); });
describe('Claude subscription usage', () => {
  it('uses only the provider OAuth endpoint and returns no credentials', async () => {
    auth();
    const before = fs.readFileSync(path.join(home, '.credentials.json'), 'utf8');
    const snapshot = await getClaudeSnapshot(home);
    expect(snapshot).toMatchObject({ ok: true, providerId: 'claude', plan: 'max', topModel: null, reserve: null, windows: { fiveHour: { usedPercent: 42 }, weekly: { usedPercent: 65 } } });
    expect(fetch).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/usage', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' }) }));
    expect(JSON.stringify(snapshot)).not.toContain(token);
    expect(fs.readFileSync(path.join(home, '.credentials.json'), 'utf8')).toBe(before);
  });
  it('preserves missing credentials and rejects API-key-only logins', async () => {
    expect(await getClaudeSnapshot(home)).toMatchObject({ ok: false, error: { kind: 'missing-credential' } });
    auth({ apiKey: 'not-a-subscription-token' });
    expect(await getClaudeSnapshot(home)).toMatchObject({ ok: false, windows: {}, error: { kind: 'missing-credential' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects malformed and expired credentials without network access', async () => {
    fs.writeFileSync(path.join(home, '.credentials.json'), '{');
    expect(await getClaudeSnapshot(home)).toMatchObject({ ok: false, error: { kind: 'malformed-credential' } });
    auth({ claudeAiOauth: { accessToken: token, expiresAt: 1 } });
    expect(await getClaudeSnapshot(home)).toMatchObject({ ok: false, error: { kind: 'authentication-expired' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('handles HTTP %s without exposing response bodies', async status => {
    auth(); vi.mocked(fetch).mockResolvedValue(new Response(token, { status }));
    const result = await getClaudeSnapshot(home);
    expect(result.ok).toBe(false); expect(result.windows).toEqual({});
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it('sanitizes network exceptions', async () => {
    auth(); vi.mocked(fetch).mockRejectedValue(new Error(token));
    const result = await getClaudeSnapshot(home);
    expect(result.error?.kind).toBe('network-failure');
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it.each(['null', '{}', 'not json', '{"five_hour":{"utilization":"42"}}'])('rejects unsupported responses: %s', async body => {
    auth(); vi.mocked(fetch).mockResolvedValue(new Response(body));
    expect(await getClaudeSnapshot(home)).toMatchObject({ ok: false, windows: {}, error: { kind: 'parse-failure' } });
  });
  it('does not turn absent or invalid windows into zero quota usage', () => {
    expect(mapClaudeWindows({ five_hour: null, seven_day: { utilization: -1 } })).toEqual({});
    expect(mapClaudeWindows({ five_hour: { utilization: 0, resets_at: 'bad date' } })).toEqual({ fiveHour: { id: 'fiveHour', usedPercent: 0, resetAt: null, windowSeconds: 18_000 } });
  });
});
