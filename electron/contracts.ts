import type { Forecast } from './forecast';
import type { ResearchAnswers, ResearchReport } from './research';

export interface UsageWindow {
  id: 'fiveHour' | 'weekly';
  usedPercent: number;
  resetAt: string | null;
  windowSeconds: number | null;
  forecast?: Forecast;
}

export interface UsageSnapshot {
  ok: boolean;
  providerId: 'codex' | 'claude';
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
  topModel: string | null;
  reserve: {
    available: number | null;
    nextExpiresAt: string | null;
    expirations: string[];
    balance: number | null;
    unit: string;
  } | null;
  error?: { kind: string; message: string };
}

export interface DiagnosticEntry {
  id: string;
  level: 'info' | 'error';
  providerId: 'codex' | 'claude' | 'system';
  accountLabel: string | null;
  message: string;
  timestamp: string;
}

export interface UsageSnapshotPayload {
  codex: UsageSnapshot[];
  claude: UsageSnapshot[];
  diagnostics: DiagnosticEntry[];
  lastCheckedAt: string | null;
  view: 'dashboard' | 'popover';
}

export interface TrackemConfig {
  codexProfileHomes: string[];
  notifyOnResetExpiry: boolean;
  resetExpiryDays: number;
  codexEnabled: boolean;
  claudeEnabled: boolean;
  claudeHome: string;
  scanLocalModels: boolean;
  launchAtLogin: boolean;
  notifyOnLowUsage: boolean;
  localResearch: boolean;
}

export interface ConfigPayload {
  config: TrackemConfig;
  file: string;
  startupSupported: boolean;
}

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
  clearResearch(): Promise<ResearchReport>;
  copyResearch(): Promise<void>;
  onUsageUpdated(callback: (payload: UsageSnapshotPayload) => void): () => void;
}
