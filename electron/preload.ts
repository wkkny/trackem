import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface UsageSnapshotPayload {
  codex: unknown[];
  claude: unknown[];
  diagnostics: unknown[];
}

const api = {
  quit: (): void => ipcRenderer.send('app:quit'),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  openDashboard: (): void => ipcRenderer.send('window:dashboard'),
  getUsage: (): Promise<UsageSnapshotPayload> => ipcRenderer.invoke('usage:get'),
  refreshUsage: (): Promise<void> => ipcRenderer.invoke('usage:refresh'),
  getConfig: (): Promise<unknown> => ipcRenderer.invoke('config:get'),
  setConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:set', config),
  getResearch: (): Promise<unknown> => ipcRenderer.invoke('research:get'),
  saveResearch: (answers: unknown): Promise<unknown> => ipcRenderer.invoke('research:save', answers),
  clearResearch: (): Promise<unknown> => ipcRenderer.invoke('research:clear'),
  copyResearch: (): Promise<void> => ipcRenderer.invoke('research:copy'),
  onUsageUpdated: (callback: (payload: UsageSnapshotPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: UsageSnapshotPayload): void => callback(payload);
    ipcRenderer.on('usage:updated', listener);
    return () => ipcRenderer.removeListener('usage:updated', listener);
  },
};

export type TrackemApi = typeof api;
contextBridge.exposeInMainWorld('trackem', api);
