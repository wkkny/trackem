import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ConfigPayload, TrackemApi, TrackemConfig, UsageSnapshotPayload } from './contracts';

const api: TrackemApi = {
  quit: (): void => ipcRenderer.send('app:quit'),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  getUsage: (): Promise<UsageSnapshotPayload> => ipcRenderer.invoke('usage:get'),
  refreshUsage: (): Promise<void> => ipcRenderer.invoke('usage:refresh'),
  getConfig: (): Promise<ConfigPayload> => ipcRenderer.invoke('config:get'),
  setConfig: (config: TrackemConfig): Promise<ConfigPayload> => ipcRenderer.invoke('config:set', config),
  onUsageUpdated: (callback: (payload: UsageSnapshotPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: UsageSnapshotPayload): void => callback(payload);
    ipcRenderer.on('usage:updated', listener);
    return () => ipcRenderer.removeListener('usage:updated', listener);
  },
};

contextBridge.exposeInMainWorld('trackem', api);
