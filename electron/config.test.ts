import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, saveConfig } from './config';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('config', () => {
  it('keeps optional file scanning, startup, and study off unless explicitly enabled', () => {
    expect(normalizeConfig({ scanLocalModels: 'true', launchAtLogin: 1, localResearch: 'yes' })).toMatchObject({ scanLocalModels: false, launchAtLogin: false, localResearch: false });
    expect(normalizeConfig({ codexEnabled: false, claudeEnabled: false })).toMatchObject({ codexEnabled: false, claudeEnabled: false });
  });
  it('normalizes duplicates, limits days, and rejects invalid values', () => {
    const result = normalizeConfig({
      codexProfileHomes: ['/tmp/work', '/tmp/work', '', 42],
      notifyOnResetExpiry: false,
      resetExpiryDays: 100,
    });
    expect(result.codexProfileHomes).toEqual([path.resolve('/tmp/work')]);
    expect(result.notifyOnResetExpiry).toBe(false);
    expect(result.resetExpiryDays).toBe(30);
  });

  it('persists a normalized private config and loads it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-config-'));
    directories.push(directory);
    const file = path.join(directory, 'nested', 'config.json');
    const saved = saveConfig(file, { codexProfileHomes: ['/tmp/a'], resetExpiryDays: 4 });
    expect(loadConfig(file)).toEqual(saved);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('uses defaults for a missing file without reporting an error', () => {
    const errors: string[] = [];
    expect(loadConfig('/definitely/missing/trackem.json', (message) => errors.push(message))).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual([]);
  });

  it('reports malformed files before using defaults', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-config-'));
    directories.push(directory);
    const file = path.join(directory, 'config.json');
    fs.writeFileSync(file, 'not JSON');
    const errors: string[] = [];

    expect(loadConfig(file, (message) => errors.push(message))).toEqual(DEFAULT_CONFIG);
    expect(errors[0]).toContain('Could not load preferences');
  });
});
