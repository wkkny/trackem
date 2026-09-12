import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface UsageSnapshotPayload {
  codex: unknown[];
  diagnostics: unknown[];
}

const api = {
  quit: (): void => ipcRenderer.send('app:quit'),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  getUsage: (): Promise<UsageSnapshotPayload> => ipcRenderer.invoke('usage:get'),
  refreshUsage: (): Promise<void> => ipcRenderer.invoke('usage:refresh'),
  getConfig: (): Promise<unknown> => ipcRenderer.invoke('config:get'),
  setConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:set', config),
  setTrayIcon: (dataUrl: string): void => ipcRenderer.send('tray:set-icon', dataUrl),
  onUsageUpdated: (callback: (payload: UsageSnapshotPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: UsageSnapshotPayload): void => callback(payload);
    ipcRenderer.on('usage:updated', listener);
    return () => ipcRenderer.removeListener('usage:updated', listener);
  },
};

export type TrackemApi = typeof api;
contextBridge.exposeInMainWorld('trackem', api);
