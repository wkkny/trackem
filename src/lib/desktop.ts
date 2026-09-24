import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ConfigPayload, ResearchAnswers, ResearchReport, TrackemConfig, UsageSnapshotPayload } from '@/types';

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const desktop = {
  quit: () => invoke<void>('app_quit'),
  hide: () => invoke<void>('window_hide'),
  openDashboard: () => invoke<void>('window_dashboard'),
  getUsage: () => invoke<UsageSnapshotPayload>('usage_get'),
  refreshUsage: () => invoke<void>('usage_refresh'),
  getConfig: () => invoke<ConfigPayload>('config_get'),
  setConfig: (config: TrackemConfig) => invoke<ConfigPayload>('config_set', { nextConfig: config }),
  getResearch: () => invoke<ResearchReport>('research_get'),
  saveResearch: (answers: ResearchAnswers) => invoke<ResearchReport>('research_save', { answers }),
  clearResearch: () => invoke<ResearchReport>('research_clear'),
  copyResearch: () => invoke<void>('research_copy'),
  onUsageUpdated: (callback: (payload: UsageSnapshotPayload) => void): Promise<UnlistenFn> =>
    listen<UsageSnapshotPayload>('usage:updated', event => callback(event.payload)),
};
