import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanSessionUsage, type SessionUsageSummary } from './sessions';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const FETCH_TIMEOUT_MS = 10_000;

export const AuthError = {
  MISSING: 'missing-credential',
  MALFORMED: 'malformed-credential',
  EXPIRED: 'authentication-expired',
  NETWORK: 'network-failure',
  API: 'api-failure',
  PARSE: 'parse-failure',
} as const;

export interface UsageWindow {
  id: 'fiveHour' | 'weekly';
  usedPercent: number;
  resetAt: string | null;
  windowSeconds: number | null;
}

export interface UsageSnapshot {
  ok: boolean;
  providerId: 'codex';
  account: {
    id: string;
    label: string;
    email: string | null;
    home: string;
    isDefault: boolean;
  };
  plan: string | null;
  source: string;
  updatedAt: string;
  windows: Partial<Record<'fiveHour' | 'weekly', UsageWindow>>;
  /** Most-used model derived from local Codex session logs (token counts per model). */
  topModel: string | null;
  /** Rate-limit reset credits ("reserve") from /wham/rate-limit-reset-credits. */
  reserve: {
    available: number;
    nextExpiresAt: string | null;
    expirations: string[];
    balance: number | null;
    unit: string;
  } | null;
  error?: { kind: string; message: string };
}

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
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
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

async function request(credentials: CodexCredentials, url: string, timeout = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { headers: buildRequestHeaders(credentials), signal: controller.signal });
  } catch (error) {
    fail(AuthError.NETWORK, `Network error contacting Codex: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUsageResponse(credentials: CodexCredentials): Promise<WhamUsageResponse> {
  const response = await request(credentials, USAGE_URL);
  if (response.status === 401 || response.status === 403) {
    fail(AuthError.EXPIRED, 'Codex token expired or invalid. Run `codex login` to re-authenticate.');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    fail(AuthError.API, `Codex usage API error ${response.status}: ${body.slice(0, 200)}`);
  }
  try {
    return (await response.json()) as WhamUsageResponse;
  } catch {
    fail(AuthError.PARSE, 'Codex usage API returned a non-JSON response.');
  }
}

export function mapWindow(window: WhamWindow | undefined, id: UsageWindow['id']): UsageWindow | null {
  if (!window || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) return null;
  return {
    id,
    usedPercent: Math.min(100, Math.max(0, window.used_percent)),
    resetAt:
      typeof window.reset_at === 'number' && Number.isFinite(window.reset_at)
        ? new Date(window.reset_at * 1000).toISOString()
        : null,
    windowSeconds:
      typeof window.limit_window_seconds === 'number' && Number.isFinite(window.limit_window_seconds)
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
      ? { available: 0, nextExpiresAt: null, expirations: [], balance, unit: 'credits' }
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
    const response = await request(credentials, RESET_CREDITS_URL, 8_000);
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      available_count?: number;
      credits?: Array<{ status?: string; expires_at?: string; redeemed_at?: string | null }>;
    };
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

async function getProfileSnapshot(profile: CodexProfile): Promise<UsageSnapshot> {
  try {
    const credentials = readCredentials(profile);
    if (credentials.expired) fail(AuthError.EXPIRED, `Codex token expired for ${profile.home}. Run \`codex login\`.`);
    const data = await fetchUsageResponse(credentials);
    const [resetCredits, sessionUsage] = await Promise.all([
      fetchResetCredits(credentials),
      scanSessionUsage(profile.home),
    ]);
    return mapSnapshot(profile, credentials, data, resetCredits, sessionUsage);
  } catch (error) {
    return mapError(profile, error);
  }
}

/** Fetch normalized snapshots for the default profile and each configured profile. Never throws. */
export async function getSnapshots(configuredHomes: string[] = []): Promise<UsageSnapshot[]> {
  return Promise.all(discoverProfiles(configuredHomes).map(getProfileSnapshot));
}

/** Backwards-compatible single-profile helper. */
export async function getSnapshot(): Promise<UsageSnapshot> {
  return (await getSnapshots())[0];
}
