export type { UsageWindow, UsageSnapshot } from '../electron/providers/codex';
export type { TrackemConfig } from '../electron/config';
export type { DiagnosticEntry } from '../electron/main';
import type { UsageSnapshot } from '../electron/providers/codex';
import type { TrackemConfig } from '../electron/config';
import type { DiagnosticEntry } from '../electron/main';
import type { ResearchReport, ResearchAnswers } from '../electron/research';

export interface UsageSnapshotPayload {
  codex: UsageSnapshot[];
  claude: UsageSnapshot[];
  diagnostics: DiagnosticEntry[];
  lastCheckedAt: string | null;
  view: 'dashboard' | 'popover';
}
export interface ConfigPayload { config: TrackemConfig; file: string; startupSupported: boolean }
export interface TrackemApi {
  quit(): void;
  minimize(): void;
  openDashboard(): void;
  getUsage(): Promise<UsageSnapshotPayload>;
  refreshUsage(): Promise<void>;
  getConfig(): Promise<ConfigPayload>;
  setConfig(config: TrackemConfig): Promise<ConfigPayload>;
  getResearch(): Promise<ResearchReport>;
  saveResearch(answers: ResearchAnswers): Promise<ResearchReport>;
  copyResearch(): Promise<void>;
  clearResearch(): Promise<ResearchReport>;
  onUsageUpdated(callback: (payload: UsageSnapshotPayload) => void): () => void;
}
declare global { interface Window { trackem: TrackemApi | undefined } }
