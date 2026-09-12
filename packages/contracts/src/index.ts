export interface Forecast {
  status: 'collecting' | 'idle' | 'depleting' | 'lasts' | 'exhausted' | 'stale';
  runsOutAt: string | null;
  sampleMinutes: number;
}

export interface ResearchAnswers {
  paidTools: 'unanswered' | 'one' | 'two' | 'three-plus';
  wouldPay: 'unanswered' | 'no' | 'maybe' | 'yes-3' | 'yes-5' | 'yes-10';
  useful: 'unanswered' | 'yes' | 'no';
}
export interface ResearchReport {
  version: 1;
  enabled: boolean;
  daysSinceStart: number;
  activeDays: number[];
  opens: number;
  answers: ResearchAnswers;
}


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
  appVersion: string;
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
  getPage(): Promise<'Overview' | 'Settings'>;
  onNavigate(callback: (page: 'Overview' | 'Settings') => void): () => void;
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
