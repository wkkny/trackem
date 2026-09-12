import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, screen, powerMonitor, clipboard } from 'electron';
import type { WebContents } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSnapshots } from './providers/codex';
import { getClaudeSnapshot } from './providers/claude';
import { DEFAULT_CONFIG, loadConfig, saveConfig, normalizeConfig, type TrackemConfig } from './config';
import { forecastUsage, type Observation } from './forecast';
import { popoverBounds } from './tray';
import { LocalResearch } from './research';
import type { ConfigPayload, DiagnosticEntry, UsageSnapshot, UsageSnapshotPayload } from './contracts';

export type { DiagnosticEntry } from './contracts';

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
if (process.platform === 'darwin') app.dock?.hide();
if (process.platform === 'win32') app.setAppUserModelId('com.trackem.app');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let latestCodexSnapshots: UsageSnapshot[] = [];
let latestClaudeSnapshots: UsageSnapshot[] = [];
let config: TrackemConfig = { ...DEFAULT_CONFIG };
let configFile = '';
let research: LocalResearch;
let quitting = false;
let suspended = false;
let inFlight: Promise<void> | null = null;
let lastAttempt = 0;
let lastCheckedAt: string | null = null;
let failures = 0;
let view: 'dashboard' | 'popover' = 'dashboard';
let logSequence = 0;
const diagnostics: DiagnosticEntry[] = [];
const history = new Map<string, Observation[]>();
const sentNotifications = new Map<string, number>();
const REFRESH_INTERVAL_MS = 5 * 60_000;
const DEVELOPMENT_RENDERER_URL = 'http://localhost:5173/';
const startupSupported = () => app.isPackaged && ['win32', 'darwin'].includes(process.platform);
const loginSettings = () => app.getLoginItemSettings({ args: ['--hidden'] });

function rendererUrl(): string {
  return app.isPackaged ? pathToFileURL(path.join(__dirname, '../../dist/index.html')).href : DEVELOPMENT_RENDERER_URL;
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

function addDiagnostic(level: DiagnosticEntry['level'], providerId: DiagnosticEntry['providerId'], message: string, accountLabel: string | null = null): void {
  diagnostics.unshift({ id: `${Date.now()}-${logSequence++}`, level, providerId, accountLabel, message, timestamp: new Date().toISOString() });
  if (diagnostics.length > 100) diagnostics.length = 100;
}
function payload(): UsageSnapshotPayload { return { codex: latestCodexSnapshots, claude: latestClaudeSnapshots, diagnostics: [...diagnostics], lastCheckedAt, view }; }
function publish(): void { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('usage:updated', payload()); }
function configPayload(): ConfigPayload { return { config, file: configFile, startupSupported: startupSupported() }; }

function showDashboard(): void {
  if (!mainWindow) return;
  view = 'dashboard';
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(760, 600);
  mainWindow.setSize(1080, 760);
  mainWindow.center();
  publish();
  mainWindow.show(); mainWindow.focus();
  recordOpen();
}
function recordOpen(): void {
  try { research?.recordOpen(); } catch { addDiagnostic('error', 'system', 'Could not save local study data'); }
}
function showPopover(): void {
  if (!mainWindow || !tray) return;
  view = 'popover';
  const anchor = tray.getBounds();
  const display = screen.getDisplayMatching(anchor);
  mainWindow.setMinimumSize(1, 1);
  mainWindow.setResizable(false);
  mainWindow.setBounds(popoverBounds(anchor, display.workArea));
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
  publish();
  mainWindow.show(); mainWindow.focus();
  recordOpen();
  if (Date.now() - lastAttempt > REFRESH_INTERVAL_MS) void refreshUsage();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080, height: 760, minWidth: 760, minHeight: 600, frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    trafficLightPosition: { x: 20, y: 20 }, backgroundColor: '#f7f8fa', show: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
  });
  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html')).catch(error => addDiagnostic('error', 'system', `Could not load the app window: ${error instanceof Error ? error.message : 'unknown error'}`));
  } else {
    void mainWindow.loadURL(DEVELOPMENT_RENDERER_URL).catch(error => addDiagnostic('error', 'system', `Could not load the development server: ${error instanceof Error ? error.message : 'unknown error'}`));
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape') { mainWindow?.hide(); event.preventDefault(); } });
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden') && !(process.platform === 'darwin' && loginSettings().wasOpenedAtLogin)) showDashboard();
  });
  mainWindow.on('blur', () => { if (view === 'popover') mainWindow?.hide(); });
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow?.hide(); } });
}

function updateTrayTooltip(): void {
  const parts = [...latestCodexSnapshots, ...latestClaudeSnapshots].filter(s => s.ok).map(snapshot => {
    const windows = Object.values(snapshot.windows);
    const remaining = Math.round(100 - Math.max(...windows.map(w => w.usedPercent)));
    return `${snapshot.providerId === 'codex' ? 'Codex' : 'Claude'} ${remaining}% left`;
  });
  tray?.setToolTip((parts.length ? `Trackem: ${parts.join(' · ')}` : 'Trackem: no connected providers').slice(0, 127));
}

function notify(key: string, expires: number, title: string, body: string): void {
  if (!Notification.isSupported() || sentNotifications.has(key)) return;
  sentNotifications.set(key, expires);
  const notification = new Notification({ title, body });
  notification.on('click', showDashboard);
  notification.show();
}

function enrichAndNotify(snapshots: UsageSnapshot[]): void {
  const now = Date.now();
  const activeKeys = new Set<string>();
  for (const [key, expires] of sentNotifications) if (expires <= now) sentNotifications.delete(key);
  if (!config.notifyOnLowUsage) for (const key of sentNotifications.keys()) if (!key.startsWith('reset:')) sentNotifications.delete(key);
  if (!config.notifyOnResetExpiry) for (const key of sentNotifications.keys()) if (key.startsWith('reset:')) sentNotifications.delete(key);
  for (const snapshot of snapshots) {
    if (!snapshot.ok) continue;
    const provider = snapshot.providerId === 'codex' ? 'Codex' : 'Claude';
    for (const window of Object.values(snapshot.windows)) {
      const key = `${snapshot.providerId}:${snapshot.account.id}:${window.id}`;
      activeKeys.add(key);
      const samples = history.get(key) ?? [];
      const last = samples.at(-1);
      const observation = { at: now, used: window.usedPercent, resetAt: window.resetAt };
      if (!last || now - last.at >= 60_000) samples.push(observation);
      else samples[samples.length - 1] = observation;
      const recent = samples.filter(s => s.at >= now - 2 * 60 * 60_000).slice(-120);
      history.set(key, recent);
      window.forecast = forecastUsage(recent, now);
      const reset = window.resetAt ? Date.parse(window.resetAt) : NaN;
      const eta = window.forecast.runsOutAt ? Date.parse(window.forecast.runsOutAt) - now : Infinity;
      if (config.notifyOnLowUsage && reset > now && (window.usedPercent >= 90 || eta <= 60 * 60_000)) {
        notify(`${key}:${window.resetAt}`, reset, `${provider} quota warning`, `${window.id === 'fiveHour' ? 'Session' : 'Weekly'} quota: ${Math.round(100 - window.usedPercent)}% left.${eta <= 60 * 60_000 ? ' Estimated to run out within an hour at your recent pace.' : ''}`);
      }
    }
    const expiry = snapshot.reserve?.nextExpiresAt;
    if (config.notifyOnResetExpiry && snapshot.reserve && (snapshot.reserve.available ?? 0) > 0 && expiry) {
      const expires = Date.parse(expiry);
      if (expires > now && expires - now <= config.resetExpiryDays * 86_400_000) notify(`reset:${snapshot.account.id}:${expiry}`, expires, 'Codex reset expiring soon', `A banked reset expires on ${new Date(expiry).toLocaleDateString()}. Open Trackem for details.`);
    }
  }
  for (const key of history.keys()) if (!activeKeys.has(key)) history.delete(key);
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!suspended && !quitting) refreshTimer = setTimeout(() => void refreshUsage(), Math.min(30 * 60_000, REFRESH_INTERVAL_MS * 2 ** failures));
}
function refreshUsage(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (suspended || (!force && Date.now() - lastAttempt < 30_000)) return Promise.resolve();
  lastAttempt = Date.now();
  inFlight = (async () => {
    const [codex, claude] = await Promise.all([
      config.codexEnabled ? getSnapshots(config.codexProfileHomes, config.scanLocalModels) : Promise.resolve([]),
      config.claudeEnabled ? getClaudeSnapshot(config.claudeHome).then(s => [s]) : Promise.resolve([]),
    ]);
    latestCodexSnapshots = codex; latestClaudeSnapshots = claude;
    const all = [...codex, ...claude];
    lastCheckedAt = new Date().toISOString();
    failures = all.length && all.every(s => !s.ok) ? Math.min(failures + 1, 3) : 0;
    for (const snapshot of all) addDiagnostic(snapshot.ok ? 'info' : 'error', snapshot.providerId, snapshot.ok ? `Quota refreshed in ${Date.now() - lastAttempt} ms` : snapshot.error?.message ?? 'Quota refresh failed', snapshot.account.label);
    enrichAndNotify(all);
    updateTrayTooltip(); publish();
  })().catch(() => { addDiagnostic('error', 'system', 'Usage refresh failed'); failures = Math.min(failures + 1, 3); publish(); })
    .finally(() => { inFlight = null; scheduleRefresh(); });
  return inFlight;
}

function createTray(): void {
  const resourceDirectory = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..', 'build');
  const templateIcon = process.platform === 'darwin' ? nativeImage.createFromPath(path.join(resourceDirectory, 'trayTemplate.png')) : nativeImage.createEmpty();
  const icon = templateIcon.isEmpty()
    ? nativeImage.createFromPath(path.join(resourceDirectory, 'icon.png')).resize({ width: 24, height: 24 })
    : templateIcon;
  if (process.platform === 'darwin' && !templateIcon.isEmpty()) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Trackem: usage at a glance');
  tray.on('click', () => { if (mainWindow?.isVisible() && view === 'popover') mainWindow.hide(); else showPopover(); });
  tray.on('right-click', () => tray?.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Open dashboard', click: showDashboard },
    { label: 'Refresh usage', click: () => void refreshUsage(true) },
    { type: 'separator' }, { label: 'Quit Trackem', click: () => app.quit() },
  ])));
}

if (hasLock) void app.whenReady().then(() => {
  configFile = path.join(app.getPath('userData'), 'config.json');
  config = loadConfig(configFile, message => addDiagnostic('error', 'system', message));
  if (startupSupported()) config.launchAtLogin = loginSettings().openAtLogin;
  research = new LocalResearch(path.join(app.getPath('userData'), 'research.json'), config.localResearch);
  addDiagnostic('info', 'system', 'Trackem started');
  createTray(); createWindow(); void refreshUsage();
  powerMonitor.on('suspend', () => { suspended = true; if (refreshTimer) clearTimeout(refreshTimer); });
  powerMonitor.on('resume', () => { suspended = false; history.clear(); void refreshUsage(true); });
}).catch(error => {
  console.error('Trackem failed to start:', error);
  app.quit();
});
app.on('second-instance', showDashboard);
app.on('activate', () => { if (mainWindow) showDashboard(); });

ipcMain.handle('usage:get', event => { assertTrustedSender(event.sender); return payload(); });
ipcMain.handle('usage:refresh', event => { assertTrustedSender(event.sender); return refreshUsage(true); });
ipcMain.handle('config:get', event => { assertTrustedSender(event.sender); return configPayload(); });
ipcMain.handle('config:set', async (event, nextConfig: unknown) => {
  assertTrustedSender(event.sender);
  await inFlight;
  const next = normalizeConfig(nextConfig);
  if (startupSupported() && next.launchAtLogin !== config.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] });
    next.launchAtLogin = loginSettings().openAtLogin;
  } else if (!startupSupported()) next.launchAtLogin = false;
  config = saveConfig(configFile, next);
  research.setEnabled(config.localResearch);
  history.clear();
  addDiagnostic('info', 'system', 'Preferences saved');
  await refreshUsage(true);
  return configPayload();
});
ipcMain.handle('research:get', event => { assertTrustedSender(event.sender); return research.report(); });
ipcMain.handle('research:save', (event, answers: unknown) => { assertTrustedSender(event.sender); return research.save(answers); });
ipcMain.handle('research:clear', event => { assertTrustedSender(event.sender); return research.clear(); });
ipcMain.handle('research:copy', event => { assertTrustedSender(event.sender); clipboard.writeText(JSON.stringify(research.report(), null, 2)); });
ipcMain.on('window:dashboard', event => { if (isTrustedSender(event.sender)) showDashboard(); });
ipcMain.on('app:quit', event => { if (isTrustedSender(event.sender)) app.quit(); });
ipcMain.on('window:minimize', event => { if (isTrustedSender(event.sender)) mainWindow?.hide(); });
app.on('window-all-closed', () => undefined);
app.on('before-quit', () => { quitting = true; if (refreshTimer) clearTimeout(refreshTimer); });
