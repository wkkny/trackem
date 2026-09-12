import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } from 'electron';
import * as path from 'node:path';
import { getSnapshots, type UsageSnapshot } from './providers/codex';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type TrackemConfig } from './config';

// Tray-only on macOS: no Dock icon, the tray menu is the entry point.
if (process.platform === 'darwin') app.dock?.hide();

export interface DiagnosticEntry {
  id: string;
  level: 'info' | 'error';
  providerId: 'codex' | 'system';
  accountLabel: string | null;
  message: string;
  timestamp: string;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let latestCodexSnapshots: UsageSnapshot[] = [];
let config: TrackemConfig = { ...DEFAULT_CONFIG };
let configFile = '';
let logSequence = 0;
const diagnostics: DiagnosticEntry[] = [];
const sentResetNotifications = new Set<string>();

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// eslint-disable-next-line no-var
declare global { var isQuitting: boolean; }

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

function payload() {
  return { codex: latestCodexSnapshots, diagnostics: [...diagnostics] };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
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
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  } else {
    void mainWindow.loadURL('http://localhost:5173');
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('file:') : url.startsWith('http://localhost:5173');
    if (!allowed) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!global.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function bestSnapshot(snapshots: UsageSnapshot[]): UsageSnapshot | null {
  const connected = snapshots.filter((snapshot) => snapshot.ok);
  return connected.sort((a, b) => {
    const aUsed = a.windows.weekly?.usedPercent ?? a.windows.fiveHour?.usedPercent ?? 101;
    const bUsed = b.windows.weekly?.usedPercent ?? b.windows.fiveHour?.usedPercent ?? 101;
    return aUsed - bUsed;
  })[0] ?? null;
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
  if (!config.notifyOnResetExpiry || !Notification.isSupported()) return;
  const threshold = config.resetExpiryDays * 24 * 60 * 60 * 1000;
  for (const snapshot of snapshots) {
    if (!snapshot.ok || !snapshot.reserve || snapshot.reserve.available <= 0) continue;
    const expiry = snapshot.reserve.nextExpiresAt;
    if (!expiry) continue;
    const remaining = new Date(expiry).getTime() - Date.now();
    if (remaining <= 0 || remaining > threshold) continue;
    const notificationKey = `${snapshot.account.id}:${expiry}`;
    if (sentResetNotifications.has(notificationKey)) continue;
    sentResetNotifications.add(notificationKey);
    const days = Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
    new Notification({
      title: 'Codex reset expiring soon',
      body: `${snapshot.account.label} has ${snapshot.reserve.available} banked reset${snapshot.reserve.available === 1 ? '' : 's'}; the next expires in ${days} day${days === 1 ? '' : 's'}.`,
    }).show();
  }
}

async function refreshUsage(): Promise<void> {
  const startedAt = Date.now();
  latestCodexSnapshots = await getSnapshots(config.codexProfileHomes);
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

function startRefreshLoop(): void {
  void refreshUsage();
  refreshTimer = setInterval(() => void refreshUsage(), REFRESH_INTERVAL_MS);
}

function createTray(): void {
  // Placeholder until the renderer rasterizes the react-icons Codex logo.
  tray = new Tray(nativeImage.createEmpty());
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
        global.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

app.whenReady().then(() => {
  global.isQuitting = false;
  configFile = path.join(app.getPath('userData'), 'config.json');
  config = loadConfig(configFile);
  addDiagnostic('info', 'system', 'Trackem started');
  createWindow();
  createTray();
  startRefreshLoop();
});

ipcMain.handle('usage:get', () => payload());
ipcMain.handle('usage:refresh', () => refreshUsage());
ipcMain.handle('config:get', () => ({ config, file: configFile }));
ipcMain.handle('config:set', async (_event, nextConfig: unknown) => {
  config = saveConfig(configFile, nextConfig);
  addDiagnostic('info', 'system', 'Preferences saved');
  await refreshUsage();
  return { config, file: configFile };
});
ipcMain.on('tray:set-icon', (_event, dataUrl: string) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return;
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (process.platform === 'darwin') image.setTemplateImage(true);
    tray?.setImage(image);
  } catch {
    addDiagnostic('error', 'system', 'Renderer supplied an invalid tray icon');
  }
});
ipcMain.on('app:quit', () => {
  global.isQuitting = true;
  app.quit();
});
ipcMain.on('window:minimize', () => mainWindow?.hide());
app.on('window-all-closed', () => undefined);
app.on('before-quit', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
