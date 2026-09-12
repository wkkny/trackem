import { app, Menu, nativeImage, powerMonitor, Tray } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import { usageLabels } from './menu';
import { getSnapshot, type UsageSnapshot } from './providers/codex';

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('com.trackem.app');

let tray: Tray | null = null;
let latestSnapshot: UsageSnapshot | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshPromise: Promise<void> | null = null;
const REFRESH_INTERVAL_MS = 5 * 60_000;

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../..', 'build', 'icon.ico');
}

function dataItems(): MenuItemConstructorOptions[] {
  if (!latestSnapshot) return [{ label: 'Loading Codex usage...', enabled: false }];
  const labels = usageLabels(latestSnapshot);
  if (!latestSnapshot.ok) return labels.map(label => ({ label, enabled: false }));
  return [
    { label: labels[0] ?? 'Plan: Unavailable', enabled: false },
    { type: 'separator' },
    ...labels.slice(1, 4).map(label => ({ label, enabled: false } as const)),
    { type: 'separator' },
    ...labels.slice(4).map(label => ({ label, enabled: false } as const)),
  ];
}

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    ...dataItems(),
    { type: 'separator' },
    { label: 'Refresh', click: () => void refreshUsage() },
    { label: 'Quit Trackem', click: () => app.quit() },
  ]);
}

function updateTray(): void {
  if (!tray) return;
  tray.setContextMenu(trayMenu());
  if (!latestSnapshot?.ok) {
    tray.setToolTip('Trackem: Codex usage unavailable');
    return;
  }
  const percentages = Object.values(latestSnapshot.windows).map(window => window.usedPercent);
  const remaining = percentages.length ? Math.round(100 - Math.max(...percentages)) : null;
  tray.setToolTip(remaining === null ? 'Trackem: Codex connected' : `Trackem: ${remaining}% left`);
}

function refreshUsage(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = getSnapshot()
    .then(snapshot => {
      latestSnapshot = snapshot;
      updateTray();
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  updateTray();
  tray.on('click', () => tray?.popUpContextMenu(trayMenu()));
  void refreshUsage();
  refreshTimer = setInterval(() => void refreshUsage(), REFRESH_INTERVAL_MS);
}

if (hasLock) {
  void app.whenReady().then(() => {
    createTray();
    powerMonitor.on('resume', () => void refreshUsage());
  });
}

app.on('second-instance', () => tray?.popUpContextMenu(trayMenu()));
app.on('before-quit', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
