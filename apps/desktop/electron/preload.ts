import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ConfigPayload, TrackemApi, TrackemConfig, UsageSnapshotPayload } from '@trackem/contracts';
import type { ResearchAnswers, ResearchReport } from '@trackem/contracts';

const api: TrackemApi = {
  quit: (): void => ipcRenderer.send('app:quit'),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  openDashboard: (): void => ipcRenderer.send('window:dashboard'),
  getPage: () => ipcRenderer.invoke('window:page'),
  onNavigate: callback => {
    const listener = (_event: IpcRendererEvent, page: 'Overview' | 'Settings') => callback(page);
    ipcRenderer.on('window:navigate', listener);
    return () => ipcRenderer.removeListener('window:navigate', listener);
  },
  getUsage: (): Promise<UsageSnapshotPayload> => ipcRenderer.invoke('usage:get'),
  refreshUsage: (): Promise<void> => ipcRenderer.invoke('usage:refresh'),
  getConfig: (): Promise<ConfigPayload> => ipcRenderer.invoke('config:get'),
  setConfig: (config: TrackemConfig): Promise<ConfigPayload> => ipcRenderer.invoke('config:set', config),
  getResearch: (): Promise<ResearchReport> => ipcRenderer.invoke('research:get'),
  saveResearch: (answers: ResearchAnswers): Promise<ResearchReport> => ipcRenderer.invoke('research:save', answers),
  clearResearch: (): Promise<ResearchReport> => ipcRenderer.invoke('research:clear'),
  copyResearch: (): Promise<void> => ipcRenderer.invoke('research:copy'),
  onUsageUpdated: (callback: (payload: UsageSnapshotPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: UsageSnapshotPayload): void => callback(payload);
    ipcRenderer.on('usage:updated', listener);
    return () => ipcRenderer.removeListener('usage:updated', listener);
  },
};

contextBridge.exposeInMainWorld('trackem', api);
