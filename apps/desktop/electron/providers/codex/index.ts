import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanSessionUsage, type SessionUsageSummary } from './sessions';
import type { UsageSnapshot, UsageWindow } from '@trackem/contracts';

export type { UsageSnapshot, UsageWindow } from '@trackem/contracts';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REQUEST_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;

export const AuthError = {
  MISSING: 'missing-credential',
  MALFORMED: 'malformed-credential',
  EXPIRED: 'authentication-expired',
  NETWORK: 'network-failure',
  API: 'api-failure',
  PARSE: 'parse-failure',
} as const;

interface CodexProfile {
  home: string;
  isDefault: boolean;
}

interface CodexCredentials {
  accessToken: string;
  accountId: string | null;
  email: string | null;
  expired: boolean;
  path: string;
}

interface WhamWindow {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}

interface WhamUsageResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: WhamWindow;
    secondary_window?: WhamWindow;
  };
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: number;
  };
}

interface ResetCreditsSummary {
  available: number;
  nextExpiresAt: string | null;
  expirations: string[];
}

function fail(kind: string, message: string): never {
  const error = new Error(message) as Error & { kind: string };
  error.kind = kind;
  throw error;
}

export function defaultCodexHome(): string {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

export function discoverProfiles(configuredHomes: string[] = []): CodexProfile[] {
  const defaultHome = defaultCodexHome();
  const homes = [defaultHome, ...configuredHomes.map((home) => path.resolve(home))];
  return [...new Set(homes)].slice(0, 21).map((home) => ({ home, isDefault: home === defaultHome }));
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function profileAccount(profile: CodexProfile, credentials?: CodexCredentials): UsageSnapshot['account'] {
  const email = credentials?.email ?? null;
  const profileName = path.basename(profile.home);
  const label = email ?? (profile.isDefault ? 'Default Codex' : profileName);
  const stableSource = credentials?.accountId || profile.home;
  return {
    id: crypto.createHash('sha256').update(stableSource).digest('hex').slice(0, 12),
    label,
    email,
    home: profile.home,
    isDefault: profile.isDefault,
  };
}

/** Read Codex OAuth credentials. Read-only: the Codex CLI owns auth.json token lifecycle. */
function readCredentials(profile: CodexProfile): CodexCredentials {
  const file = path.join(profile.home, 'auth.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    fail(AuthError.MISSING, `No Codex credentials found at ${file}. Run \`codex login\` for this profile.`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    fail(AuthError.MALFORMED, `Codex auth file is not valid JSON: ${file}`);
  }

  const tokens = parsed.tokens as Record<string, unknown> | undefined;
  const accessToken = tokens?.access_token;
  if (typeof accessToken !== 'string') {
    fail(AuthError.MISSING, `Codex auth file at ${file} has no OAuth token. Run \`codex login\`.`);
  }

  const accountId = typeof tokens?.account_id === 'string' ? tokens.account_id : null;
  const idToken = typeof tokens?.id_token === 'string' ? tokens.id_token : null;
  const claims = decodeJwtClaims(idToken ?? accessToken);
  const profileClaim = claims['https://api.openai.com/profile'];
  const profileData = profileClaim && typeof profileClaim === 'object' ? (profileClaim as Record<string, unknown>) : {};
  const email = typeof claims.email === 'string' ? claims.email : typeof profileData.email === 'string' ? profileData.email : null;

  return {
    accessToken,
    accountId,
    email,
    expired: isTokenExpired(accessToken),
    path: file,
  };
}

/** Best-effort JWT exp check. Malformed tokens are treated as unexpired; the API is authoritative. */
export function isTokenExpired(accessToken: string, now = Date.now()): boolean {
  const claims = decodeJwtClaims(accessToken);
  return typeof claims.exp === 'number' ? claims.exp * 1000 <= now : false;
}

function buildRequestHeaders(credentials: CodexCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.accessToken}`,
    'User-Agent': 'codex-cli',
    Accept: 'application/json',
  };
  if (credentials.accountId) headers['ChatGPT-Account-Id'] = credentials.accountId;
  return headers;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelay(response: Response): number {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return RETRY_BACKOFF_MS;
  const seconds = Number(retryAfter);
  const requestedDelay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(requestedDelay)
    ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, requestedDelay))
    : RETRY_BACKOFF_MS;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

interface RequestResult {
  response: Response;
  body: string;
}

async function request(credentials: CodexCredentials, url: string, timeout = FETCH_TIMEOUT_MS): Promise<RequestResult> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response: Response | undefined;
    let result: RequestResult | undefined;
    let failure: 'network' | 'timeout' | null = null;
    try {
      response = await fetch(url, { headers: buildRequestHeaders(credentials), signal: controller.signal, redirect: 'error' });
      result = { response, body: await response.text() };
    } catch {
      if (response && !response.ok && !isRetryableStatus(response.status)) result = { response, body: '' };
      else failure = controller.signal.aborted ? 'timeout' : 'network';
    } finally {
      clearTimeout(timer);
    }

    const canRetry = attempt + 1 < MAX_REQUEST_ATTEMPTS;
    if (failure) {
      if (canRetry) {
        await wait(RETRY_BACKOFF_MS);
        continue;
      }
      if (failure === 'timeout') fail(AuthError.NETWORK, `Codex request timed out after ${timeout} ms.`);
      fail(AuthError.NETWORK, 'Could not reach Codex. Check your connection and try again.');
    }
    if (!result) fail(AuthError.NETWORK, 'Could not reach Codex. Check your connection and try again.');
    if (canRetry && isRetryableStatus(result.response.status)) {
      await wait(retryDelay(result.response));
      continue;
    }
    return result;
  }
  fail(AuthError.NETWORK, 'Could not reach Codex. Check your connection and try again.');
}

async function fetchUsageResponse(credentials: CodexCredentials): Promise<WhamUsageResponse> {
  const { response, body } = await request(credentials, USAGE_URL);
  if (response.status === 401 || response.status === 403) {
    fail(AuthError.EXPIRED, 'Codex token expired or invalid. Run `codex login` to re-authenticate.');
  }
  if (!response.ok) {
    fail(AuthError.API, `Codex usage API returned HTTP ${response.status}. Try again later.`);
  }
  let data: WhamUsageResponse;
  try {
    data = JSON.parse(body) as WhamUsageResponse;
  } catch {
    fail(AuthError.PARSE, 'Codex usage API returned a non-JSON response.');
  }
  if (!data || typeof data !== 'object' || !data.rate_limit ||
      (!mapWindow(data.rate_limit.primary_window, 'fiveHour') && !mapWindow(data.rate_limit.secondary_window, 'weekly'))) {
    fail(AuthError.PARSE, 'Codex did not provide supported quota windows.');
  }
  return data;
}

export function mapWindow(window: WhamWindow | undefined, id: UsageWindow['id']): UsageWindow | null {
  if (!window || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100) return null;
  return {
    id,
    usedPercent: window.used_percent,
    resetAt:
      typeof window.reset_at === 'number' && Number.isFinite(window.reset_at) && Math.abs(window.reset_at) < 8.64e12
        ? new Date(window.reset_at * 1000).toISOString()
        : null,
    windowSeconds:
       typeof window.limit_window_seconds === 'number' && Number.isFinite(window.limit_window_seconds) && window.limit_window_seconds > 0
        ? window.limit_window_seconds
        : null,
  };
}

function mapSnapshot(
  profile: CodexProfile,
  credentials: CodexCredentials,
  data: WhamUsageResponse,
  resetCredits: ResetCreditsSummary | null,
  sessionUsage: SessionUsageSummary | null,
): UsageSnapshot {
  const windows: UsageSnapshot['windows'] = {};
  const fiveHour = mapWindow(data.rate_limit?.primary_window, 'fiveHour');
  const weekly = mapWindow(data.rate_limit?.secondary_window, 'weekly');
  if (fiveHour) windows.fiveHour = fiveHour;
  if (weekly) windows.weekly = weekly;

  const credits = data.credits ?? {};
  const balance = credits.has_credits && !credits.unlimited && typeof credits.balance === 'number' ? credits.balance : null;
  const reserve = resetCredits
    ? { ...resetCredits, balance, unit: 'credits' }
    : balance !== null
      ? { available: null, nextExpiresAt: null, expirations: [], balance, unit: 'credits' }
      : null;

  return {
    ok: true,
    providerId: 'codex',
    account: profileAccount(profile, credentials),
    plan: typeof data.plan_type === 'string' ? data.plan_type : null,
    source: credentials.path,
    updatedAt: new Date().toISOString(),
    windows,
    topModel: sessionUsage?.topModel ?? null,
    reserve,
  };
}

function mapError(profile: CodexProfile, error: unknown): UsageSnapshot {
  const err = error as Error & { kind?: string };
  return {
    ok: false,
    providerId: 'codex',
    account: profileAccount(profile),
    plan: null,
    source: path.join(profile.home, 'auth.json'),
    updatedAt: new Date().toISOString(),
    windows: {},
    topModel: null,
    reserve: null,
    error: { kind: err.kind ?? AuthError.API, message: err.message || 'Unknown Codex error' },
  };
}

/** Best-effort rate-limit reset credits ("reserve") summary. Never throws. */
async function fetchResetCredits(credentials: CodexCredentials): Promise<ResetCreditsSummary | null> {
  try {
    const { response, body } = await request(credentials, RESET_CREDITS_URL, 8_000);
    if (!response.ok) return null;
    const payload = JSON.parse(body) as {
      available_count?: number;
      credits?: Array<{ status?: string; expires_at?: string; redeemed_at?: string | null }>;
    };
    if (!payload || (!Array.isArray(payload.credits) && typeof payload.available_count !== 'number')) return null;
    if (payload.available_count !== undefined && (!Number.isInteger(payload.available_count) || payload.available_count < 0)) return null;
    const now = Date.now();
    const stillAvailable = (payload.credits ?? []).filter((credit) => {
      if (credit.redeemed_at || credit.status === 'expired') return false;
      if (typeof credit.expires_at === 'string' && new Date(credit.expires_at).getTime() <= now) return false;
      return true;
    });
    const expirations = stillAvailable
      .map((credit) => (typeof credit.expires_at === 'string' ? new Date(credit.expires_at).getTime() : NaN))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .map((time) => new Date(time).toISOString());
    return {
      available: typeof payload.available_count === 'number' ? payload.available_count : stillAvailable.length,
      nextExpiresAt: expirations[0] ?? null,
      expirations: expirations.slice(0, 6),
    };
  } catch {
    return null;
  }
}

async function getProfileSnapshot(profile: CodexProfile, scanModels: boolean): Promise<UsageSnapshot> {
  try {
    const credentials = readCredentials(profile);
    if (credentials.expired) fail(AuthError.EXPIRED, `Codex token expired for ${profile.home}. Run \`codex login\`.`);
    const data = await fetchUsageResponse(credentials);
    const [resetCredits, sessionUsage] = await Promise.all([
      fetchResetCredits(credentials),
      scanModels ? scanSessionUsage(profile.home) : Promise.resolve(null),
    ]);
    return mapSnapshot(profile, credentials, data, resetCredits, sessionUsage);
  } catch (error) {
    return mapError(profile, error);
  }
}

/** Fetch normalized snapshots for the default profile and each configured profile. Never throws. */
export async function getSnapshots(configuredHomes: string[] = [], scanModels = false): Promise<UsageSnapshot[]> {
  return Promise.all(discoverProfiles(configuredHomes).map(profile => getProfileSnapshot(profile, scanModels)));
}

/** Backwards-compatible single-profile helper. */
export async function getSnapshot(): Promise<UsageSnapshot> {
  const snapshot = (await getSnapshots())[0];
  if (!snapshot) throw new Error('Default Codex profile was not discovered');
  return snapshot;
}
