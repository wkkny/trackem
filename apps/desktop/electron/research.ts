import * as fs from 'node:fs';

import type { ResearchAnswers, ResearchReport } from '@trackem/contracts';
export type { ResearchAnswers, ResearchReport } from '@trackem/contracts';
const EMPTY_ANSWERS: ResearchAnswers = { paidTools: 'unanswered', wouldPay: 'unanswered', useful: 'unanswered' };
export function normalizeAnswers(value: unknown): ResearchAnswers {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const pick = (key: keyof ResearchAnswers, values: string[]) => typeof input[key] === 'string' && values.includes(input[key]) ? input[key] : 'unanswered';
  return {
    paidTools: pick('paidTools', ['one', 'two', 'three-plus']) as ResearchAnswers['paidTools'],
    wouldPay: pick('wouldPay', ['no', 'maybe', 'yes-3', 'yes-5', 'yes-10']) as ResearchAnswers['wouldPay'],
    useful: pick('useful', ['yes', 'no']) as ResearchAnswers['useful'],
  };
}

/** Local, opt-in study. Reports deliberately contain no identity, paths, quotas, or exact timestamps. */
export class LocalResearch {
  private startedAt = 0;
  private days = new Set<number>();
  private opens = 0;
  private lastOpen = 0;
  private answers = { ...EMPTY_ANSWERS };
  constructor(private file: string, private enabled: boolean) {
    if (!enabled) { this.clear(); return; }
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.startedAt = typeof data.startedAt === 'number' && data.startedAt > 0 && data.startedAt <= Date.now() ? data.startedAt : Date.now();
      this.days = new Set(Array.isArray(data.days) ? data.days.filter((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 89) : []);
      this.opens = Number.isSafeInteger(data.opens) && data.opens >= 0 ? data.opens : 0;
      this.answers = normalizeAnswers(data.answers);
    } catch { this.startedAt = Date.now(); }
  }
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.clear();
  }
  recordOpen(now = Date.now()): void {
    if (!this.enabled || now - this.lastOpen < 60_000) return;
    if (!this.startedAt) this.startedAt = now;
    const day = Math.floor((now - this.startedAt) / 86_400_000);
    if (day > 89) return;
    this.lastOpen = now;
    this.days.add(day);
    this.opens++;
    this.persist();
  }
  save(value: unknown): ResearchReport {
    if (this.enabled) { this.answers = normalizeAnswers(value); this.persist(); }
    return this.report();
  }
  clear(): ResearchReport {
    this.startedAt = this.enabled ? Date.now() : 0;
    this.days.clear(); this.opens = 0; this.lastOpen = 0; this.answers = { ...EMPTY_ANSWERS };
    fs.rmSync(this.file, { force: true });
    return this.report();
  }
  report(): ResearchReport {
    return { version: 1, enabled: this.enabled, daysSinceStart: this.startedAt ? Math.max(0, Math.floor((Date.now() - this.startedAt) / 86_400_000)) : 0, activeDays: [...this.days].sort((a, b) => a - b), opens: this.opens, answers: { ...this.answers } };
  }
  private persist(): void {
    fs.writeFileSync(this.file, JSON.stringify({ startedAt: this.startedAt, days: [...this.days], opens: this.opens, answers: this.answers }), { mode: 0o600 });
    fs.chmodSync(this.file, 0o600);
  }
}
