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
  topModel: string | null;
  reserve: {
    available: number;
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
  providerId: 'codex' | 'system';
  accountLabel: string | null;
  message: string;
  timestamp: string;
}

export interface UsageSnapshotPayload {
  codex: UsageSnapshot[];
  diagnostics: DiagnosticEntry[];
}

export interface TrackemConfig {
  codexProfileHomes: string[];
  notifyOnResetExpiry: boolean;
  resetExpiryDays: number;
}

export interface ConfigPayload {
  config: TrackemConfig;
  file: string;
}

export interface TrackemApi {
  quit(): void;
  minimize(): void;
  getUsage(): Promise<UsageSnapshotPayload>;
  refreshUsage(): Promise<void>;
  getConfig(): Promise<ConfigPayload>;
  setConfig(config: TrackemConfig): Promise<ConfigPayload>;
  setTrayIcon(dataUrl: string): void;
  onUsageUpdated(callback: (payload: UsageSnapshotPayload) => void): () => void;
}

declare global {
  interface Window {
    trackem: TrackemApi | undefined;
  }
}
