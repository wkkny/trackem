import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalResearch } from './research';

let directory: string;
let file: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trackem-research-')); file = path.join(directory, 'research.json'); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });
describe('local demand validation', () => {
  it('does not record anything unless enabled', () => {
    const study = new LocalResearch(file, false);
    study.recordOpen(); study.save({ wouldPay: 'yes-5' });
    expect(study.report()).toMatchObject({ opens: 0, activeDays: [], answers: { wouldPay: 'unanswered' } });
    expect(fs.existsSync(file)).toBe(false);
  });
  it('counts intentional opens with a cooldown and retains relative active days across restarts', () => {
    const study = new LocalResearch(file, true);
    study.recordOpen(); study.recordOpen();
    vi.advanceTimersByTime(86_400_000);
    study.recordOpen();
    const restored = new LocalResearch(file, true);
    expect(restored.report()).toMatchObject({ opens: 2, activeDays: [0, 1], daysSinceStart: 1 });
  });
  it('deletes study data on opt-out', () => {
    const study = new LocalResearch(file, true);
    study.recordOpen(); study.setEnabled(false);
    expect(fs.existsSync(file)).toBe(false); expect(study.report().opens).toBe(0);
  });
  it('exports only allowlisted answers and aggregate fields', () => {
    const study = new LocalResearch(file, true);
    const report = study.save({ paidTools: 'two', wouldPay: 'yes-5', useful: 'yes', email: 'private@example.com', token: 'secret' });
    expect(Object.keys(report).sort()).toEqual(['activeDays', 'answers', 'daysSinceStart', 'enabled', 'opens', 'version']);
    expect(report.answers).toEqual({ paidTools: 'two', wouldPay: 'yes-5', useful: 'yes' });
    expect(fs.readFileSync(file, 'utf8')).not.toContain('private@example.com');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('secret');
  });
  it('stops recording after 90 days', () => {
    const study = new LocalResearch(file, true);
    study.recordOpen(); vi.advanceTimersByTime(90 * 86_400_000); study.recordOpen();
    expect(study.report().opens).toBe(1);
  });
});
