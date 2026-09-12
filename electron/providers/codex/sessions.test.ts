import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBoundedFile, scanSessionUsage } from './sessions';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('scanSessionUsage', () => {
  it('caps bytes read even when the file exceeds the requested limit', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-session-limit-'));
    directories.push(home);
    const file = path.join(home, 'growing.jsonl');
    fs.writeFileSync(file, Buffer.alloc(128 * 1024, 'x'));

    const content = await readBoundedFile(file, 64 * 1024);

    expect(Buffer.byteLength(content)).toBe(64 * 1024);
  });
  it('counts cumulative deltas once and ignores model text inside prompts', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-session-deltas-'));
    directories.push(home);
    fs.mkdirSync(path.join(home, 'sessions'));
    fs.writeFileSync(path.join(home, 'sessions', 'one.jsonl'), [
      { type: 'turn_context', payload: { model: 'model-a' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 0 } } } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 0 } } } },
      { type: 'turn_context', payload: { model: 'model-b' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 110, output_tokens: 0 } } } },
      { type: 'message', content: { type: 'turn_context', model: 'fake-model' } },
    ].map(event => JSON.stringify(event)).join('\n'));
    expect(await scanSessionUsage(home)).toMatchObject({ topModel: 'model-a', tokensByModel: { 'model-a': 100, 'model-b': 10 } });
  });
  it('attributes token totals to the active model', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-sessions-'));
    directories.push(home);
    const sessions = path.join(home, 'sessions', '2026', '09');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'one.jsonl'), [
      '{"type":"turn_context","model":"gpt-5.6-sol"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":120,"output_tokens":30}}}}',
      '{"type":"turn_context","model":"gpt-5.3-codex"}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_count":40}}}',
    ].join('\n'));

    const result = await scanSessionUsage(home);
    expect(result.scannedFiles).toBe(1);
    expect(result.tokensByModel).toEqual({ 'gpt-5.6-sol': 150, 'gpt-5.3-codex': 40 });
    expect(result.topModel).toBe('gpt-5.6-sol');
  });
});
