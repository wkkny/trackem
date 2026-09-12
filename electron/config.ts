import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TrackemConfig } from './contracts';

export type { TrackemConfig } from './contracts';

export const DEFAULT_CONFIG: TrackemConfig = {
  codexProfileHomes: [],
  notifyOnResetExpiry: true,
  resetExpiryDays: 7,
  codexEnabled: true,
  claudeEnabled: true,
  claudeHome: '',
  scanLocalModels: false,
  launchAtLogin: false,
  notifyOnLowUsage: true,
  localResearch: false,
};

export function expandHome(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

export function normalizeConfig(value: unknown): TrackemConfig {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawHomes = Array.isArray(input.codexProfileHomes) ? input.codexProfileHomes : [];
  const homes = rawHomes
    .filter((home): home is string => typeof home === 'string' && home.trim().length > 0)
    .map(expandHome);

  return {
    codexEnabled: typeof input.codexEnabled === 'boolean' ? input.codexEnabled : true,
    claudeEnabled: typeof input.claudeEnabled === 'boolean' ? input.claudeEnabled : true,
    claudeHome: typeof input.claudeHome === 'string' && input.claudeHome.trim() ? expandHome(input.claudeHome) : '',
    scanLocalModels: input.scanLocalModels === true,
    launchAtLogin: input.launchAtLogin === true,
    notifyOnLowUsage: typeof input.notifyOnLowUsage === 'boolean' ? input.notifyOnLowUsage : true,
    localResearch: input.localResearch === true,
    codexProfileHomes: [...new Set(homes)].slice(0, 20),
    notifyOnResetExpiry:
      typeof input.notifyOnResetExpiry === 'boolean'
        ? input.notifyOnResetExpiry
        : DEFAULT_CONFIG.notifyOnResetExpiry,
    resetExpiryDays:
      typeof input.resetExpiryDays === 'number' && Number.isFinite(input.resetExpiryDays)
        ? Math.min(30, Math.max(1, Math.round(input.resetExpiryDays)))
        : DEFAULT_CONFIG.resetExpiryDays,
  };
}

export function loadConfig(file: string, onError?: (message: string) => void): TrackemConfig {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      onError?.(`Could not load preferences: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(file: string, config: unknown): TrackemConfig {
  const normalized = normalizeConfig(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  // writeFile's mode does not tighten permissions on an existing file.
  fs.chmodSync(file, 0o600);
  return normalized;
}
