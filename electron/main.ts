import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, session } from 'electron';
import type { WebContents } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSnapshots } from './providers/codex';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type TrackemConfig } from './config';
import { bestSnapshot, collectResetExpiryNotifications, createQueuedSingleFlight } from './app-logic';
import type { DiagnosticEntry, UsageSnapshot, UsageSnapshotPayload } from './contracts';

// Tray-only on macOS: no Dock icon, the tray menu is the entry point.
if (process.platform === 'darwin') app.dock?.hide();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let isQuitting = false;
let latestCodexSnapshots: UsageSnapshot[] = [];
let config: TrackemConfig = { ...DEFAULT_CONFIG };
let configFile = '';
let logSequence = 0;
const diagnostics: DiagnosticEntry[] = [];
const sentResetNotifications = new Set<string>();

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEVELOPMENT_RENDERER_URL = 'http://localhost:5173/';

function rendererUrl(): string {
  return app.isPackaged
    ? pathToFileURL(path.join(__dirname, '../../dist/index.html')).href
    : DEVELOPMENT_RENDERER_URL;
}

function isAllowedNavigation(url: string): boolean {
  try {
    const target = new URL(url);
    const allowed = new URL(rendererUrl());
    return app.isPackaged ? target.href === allowed.href : target.origin === allowed.origin;
  } catch {
    return false;
  }
}

function isTrustedSender(sender: WebContents): boolean {
  return mainWindow !== null && sender === mainWindow.webContents && isAllowedNavigation(sender.getURL());
}

function assertTrustedSender(sender: WebContents): void {
  if (!isTrustedSender(sender)) throw new Error('Blocked IPC request from an untrusted renderer');
}

function addDiagnostic(
  level: DiagnosticEntry['level'],
  providerId: DiagnosticEntry['providerId'],
  message: string,
  accountLabel: string | null = null,
): void {
  diagnostics.unshift({
    id: `${Date.now()}-${logSequence++}`,
    level,
    providerId,
    accountLabel,
    message,
    timestamp: new Date().toISOString(),
  });
  if (diagnostics.length > 100) diagnostics.length = 100;
}

function payload(): UsageSnapshotPayload {
  return { codex: latestCodexSnapshots, diagnostics: [...diagnostics] };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    trafficLightPosition: { x: 20, y: 20 },
    backgroundColor: '#f7f8fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (app.isPackaged) {
    void mainWindow.loadURL(rendererUrl()).catch((error: unknown) => {
      addDiagnostic('error', 'system', `Could not load the app window: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  } else {
    void mainWindow.loadURL(rendererUrl()).catch((error: unknown) => {
      addDiagnostic('error', 'system', `Could not load the development server: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function updateTrayTooltip(): void {
  const snapshot = bestSnapshot(latestCodexSnapshots);
  if (!snapshot) {
    tray?.setToolTip('Trackem — no connected providers');
    return;
  }
  const parts: string[] = [];
  const fiveHour = snapshot.windows.fiveHour;
  const weekly = snapshot.windows.weekly;
  if (fiveHour) parts.push(`Session ${Math.round(100 - fiveHour.usedPercent)}% left`);
  if (weekly) parts.push(`Weekly ${Math.round(100 - weekly.usedPercent)}% left`);
  const account = latestCodexSnapshots.length > 1 ? `${snapshot.account.label}: ` : '';
  tray?.setToolTip(`Trackem — ${account}${parts.join(' · ')}`);
}

function notifyExpiringResets(snapshots: UsageSnapshot[]): void {
  if (!Notification.isSupported()) return;
  for (const notification of collectResetExpiryNotifications(snapshots, config, sentResetNotifications)) {
    new Notification({ title: notification.title, body: notification.body }).show();
  }
}

async function performRefresh(): Promise<void> {
  const startedAt = Date.now();
  let snapshots: UsageSnapshot[];
  try {
    snapshots = await getSnapshots(config.codexProfileHomes);
  } catch (error) {
    addDiagnostic('error', 'system', `Usage refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return;
  }
  latestCodexSnapshots = snapshots;
  for (const snapshot of latestCodexSnapshots) {
    addDiagnostic(
      snapshot.ok ? 'info' : 'error',
      'codex',
      snapshot.ok
        ? `Quota refreshed in ${Date.now() - startedAt} ms`
        : snapshot.error?.message ?? 'Quota refresh failed',
      snapshot.account.label,
    );
  }
  updateTrayTooltip();
  notifyExpiringResets(latestCodexSnapshots);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage:updated', payload());
  }
}

const refreshUsage = createQueuedSingleFlight(performRefresh);

function startRefreshLoop(): void {
  void refreshUsage();
  refreshTimer = setInterval(() => void refreshUsage(), REFRESH_INTERVAL_MS);
}

function createTray(): void {
  const resourceDirectory = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..', 'build');
  const templateImage = process.platform === 'darwin'
    ? nativeImage.createFromPath(path.join(resourceDirectory, 'trayTemplate.png'))
    : nativeImage.createEmpty();
  const image = templateImage.isEmpty()
    ? nativeImage.createFromPath(path.join(resourceDirectory, 'icon.png')).resize({ width: 24, height: 24 })
    : templateImage;
  if (process.platform === 'darwin' && !templateImage.isEmpty()) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Trackem — usage at a glance');
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  if (process.platform === 'darwin') {
    tray.on('right-click', () => tray?.popUpContextMenu(buildTrayMenu()));
  } else {
    tray.setContextMenu(buildTrayMenu());
  }
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Trackem',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

app.whenReady().then(() => {
  configFile = path.join(app.getPath('userData'), 'config.json');
  config = loadConfig(configFile, (message) => addDiagnostic('error', 'system', message));
  addDiagnostic('info', 'system', 'Trackem started');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  createTray();
  startRefreshLoop();
}).catch((error: unknown) => {
  console.error('Trackem failed to start:', error);
  app.quit();
});

ipcMain.handle('usage:get', (event) => {
  assertTrustedSender(event.sender);
  return payload();
});
ipcMain.handle('usage:refresh', (event) => {
  assertTrustedSender(event.sender);
  return refreshUsage();
});
ipcMain.handle('config:get', (event) => {
  assertTrustedSender(event.sender);
  return { config, file: configFile };
});
ipcMain.handle('config:set', async (event, nextConfig: unknown) => {
  assertTrustedSender(event.sender);
  config = saveConfig(configFile, nextConfig);
  addDiagnostic('info', 'system', 'Preferences saved');
  await refreshUsage(true);
  return { config, file: configFile };
});
ipcMain.on('app:quit', (event) => {
  if (!isTrustedSender(event.sender)) return;
  isQuitting = true;
  app.quit();
});
ipcMain.on('window:minimize', (event) => {
  if (isTrustedSender(event.sender)) mainWindow?.hide();
});
app.on('window-all-closed', () => undefined);
app.on('before-quit', () => {
  isQuitting = true;
  if (refreshTimer) clearInterval(refreshTimer);
});
