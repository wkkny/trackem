import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanSessionUsage } from './sessions';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'trackem-sessions-'));
  directories.push(home);
  return home;
}

async function writeSession(home: string, name: string, lines: string[]): Promise<void> {
  const sessions = path.join(home, 'sessions', '2026', '09');
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, name), lines.join('\n'));
}

describe('scanSessionUsage', () => {
  it('uses positive deltas from repeated cumulative counters', async () => {
    const home = await createHome();
    await writeSession(home, 'cumulative.jsonl', [
      '{"type":"turn_context","payload":{"model":"cumulative-model"}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20}}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":120,"output_tokens":30}}}}',
    ]);
    await writeSession(home, 'single.jsonl', [
      '{"type":"turn_context","model":"single-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":200}}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result).toEqual({ topModel: 'single-model', scannedFiles: 2 });
  });

  it('prefers last_token_usage as the incremental count', async () => {
    const home = await createHome();
    await writeSession(home, 'incremental.jsonl', [
      '{"type":"turn_context","model":"incremental-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":8,"output_tokens":2},"total_token_usage":{"input_tokens":80,"output_tokens":20}}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":8,"output_tokens":2},"total_token_usage":{"input_tokens":160,"output_tokens":40}}}}',
    ]);
    await writeSession(home, 'other.jsonl', [
      '{"type":"turn_context","model":"other-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":50}}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result.topModel).toBe('other-model');
  });

  it('reconciles incremental-only events with a later cumulative counter', async () => {
    const home = await createHome();
    await writeSession(home, 'mixed.jsonl', [
      '{"type":"turn_context","model":"mixed-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":100}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":20}}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":150}}}',
    ]);
    await writeSession(home, 'comparison.jsonl', [
      '{"type":"turn_context","model":"comparison-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":160}}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result.topModel).toBe('comparison-model');
  });

  it('starts a fresh cumulative baseline after a counter reset', async () => {
    const home = await createHome();
    await writeSession(home, 'mixed-reset.jsonl', [
      '{"type":"turn_context","model":"reset-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":100}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":20}}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":10}}}',
    ]);
    await writeSession(home, 'comparison.jsonl', [
      '{"type":"turn_context","model":"comparison-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":125}}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result.topModel).toBe('reset-model');
  });

  it('attributes cumulative deltas to the model active at each event', async () => {
    const home = await createHome();
    await writeSession(home, 'switched.jsonl', [
      '{"type":"turn_context","model":"first-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":100}}}',
      '{"type":"turn_context","payload":{"model":"second-model"}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":150}}}',
    ]);
    await writeSession(home, 'comparison.jsonl', [
      '{"type":"turn_context","model":"comparison-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":75}}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result.topModel).toBe('first-model');
  });

  it('skips malformed JSONL lines', async () => {
    const home = await createHome();
    await writeSession(home, 'malformed.jsonl', [
      '{"type":"turn_context","model":"invalid-model"',
      'not json',
      '{"message":"mentions \\"turn_context\\" but is not one","model":"invalid-model"}',
      '{"type":"turn_context","model":"valid-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":25}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":100}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result).toEqual({ topModel: 'valid-model', scannedFiles: 1 });
  });

  it('does not subtract tokens when a cumulative counter resets', async () => {
    const home = await createHome();
    await writeSession(home, 'reset.jsonl', [
      '{"type":"turn_context","model":"reset-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":100}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":20}}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":30}}}',
    ]);
    await writeSession(home, 'comparison.jsonl', [
      '{"type":"turn_context","model":"comparison-model"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":135}}}',
    ]);

    const result = await scanSessionUsage(home);
    expect(result.topModel).toBe('comparison-model');
  });

  it('returns an empty summary when session directories are missing', async () => {
    const home = await createHome();

    await expect(scanSessionUsage(home)).resolves.toEqual({ topModel: null, scannedFiles: 0 });
  });
});
