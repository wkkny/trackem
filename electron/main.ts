import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, screen, powerMonitor, clipboard } from 'electron';
import * as path from 'node:path';
import { getSnapshots, type UsageSnapshot } from './providers/codex';
import { getClaudeSnapshot } from './providers/claude';
import { DEFAULT_CONFIG, loadConfig, saveConfig, normalizeConfig, type TrackemConfig } from './config';
import { forecastUsage, type Observation } from './forecast';
import { popoverBounds } from './tray';
import { LocalResearch } from './research';

export interface DiagnosticEntry {
  id: string;
  level: 'info' | 'error';
  providerId: 'codex' | 'claude' | 'system';
  accountLabel: string | null;
  message: string;
  timestamp: string;
}

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
const startupSupported = () => app.isPackaged && ['win32', 'darwin'].includes(process.platform);
const loginSettings = () => app.getLoginItemSettings({ args: ['--hidden'] });

function addDiagnostic(level: DiagnosticEntry['level'], providerId: DiagnosticEntry['providerId'], message: string, accountLabel: string | null = null): void {
  diagnostics.unshift({ id: `${Date.now()}-${logSequence++}`, level, providerId, accountLabel, message, timestamp: new Date().toISOString() });
  if (diagnostics.length > 100) diagnostics.length = 100;
}
function payload() { return { codex: latestCodexSnapshots, claude: latestClaudeSnapshots, diagnostics: [...diagnostics], lastCheckedAt, view }; }
function publish(): void { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('usage:updated', payload()); }
function configPayload() { return { config, file: configFile, startupSupported: startupSupported() }; }

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
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    trafficLightPosition: { x: 20, y: 20 }, backgroundColor: '#f7f8fa', show: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
  });
  if (app.isPackaged) void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  else void mainWindow.loadURL('http://localhost:5173');
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
  // Native bitmap is available before the renderer starts, including hidden login launches.
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 5; y < 27; y++) for (let x = 5; x < 27; x++) {
    if (y < 10 || (x >= 13 && x < 19)) {
      const offset = (y * size + x) * 4;
      pixels[offset] = process.platform === 'darwin' ? 0 : 220;
      pixels[offset + 1] = process.platform === 'darwin' ? 0 : 110;
      pixels[offset + 2] = process.platform === 'darwin' ? 0 : 100;
      pixels[offset + 3] = 255;
    }
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: process.platform === 'darwin' ? 2 : 1 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Trackem: usage at a glance');
  tray.on('click', () => { if (mainWindow?.isVisible() && view === 'popover') mainWindow.hide(); else showPopover(); });
  tray.on('right-click', () => tray?.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Open dashboard', click: showDashboard },
    { label: 'Refresh usage', click: () => void refreshUsage() },
    { type: 'separator' }, { label: 'Quit Trackem', click: () => app.quit() },
  ])));
}

if (hasLock) app.whenReady().then(() => {
  configFile = path.join(app.getPath('userData'), 'config.json');
  config = loadConfig(configFile);
  if (startupSupported()) config.launchAtLogin = loginSettings().openAtLogin;
  research = new LocalResearch(path.join(app.getPath('userData'), 'research.json'), config.localResearch);
  addDiagnostic('info', 'system', 'Trackem started');
  createTray(); createWindow(); void refreshUsage();
  powerMonitor.on('suspend', () => { suspended = true; if (refreshTimer) clearTimeout(refreshTimer); });
  powerMonitor.on('resume', () => { suspended = false; history.clear(); void refreshUsage(true); });
});
app.on('second-instance', showDashboard);
app.on('activate', () => { if (mainWindow) showDashboard(); });

ipcMain.handle('usage:get', () => payload());
ipcMain.handle('usage:refresh', () => refreshUsage());
ipcMain.handle('config:get', configPayload);
ipcMain.handle('config:set', async (_event, nextConfig: unknown) => {
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
ipcMain.handle('research:get', () => research.report());
ipcMain.handle('research:save', (_event, answers: unknown) => research.save(answers));
ipcMain.handle('research:clear', () => research.clear());
ipcMain.handle('research:copy', () => clipboard.writeText(JSON.stringify(research.report(), null, 2)));
ipcMain.on('window:dashboard', showDashboard);
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('window:minimize', () => mainWindow?.hide());
app.on('window-all-closed', () => undefined);
app.on('before-quit', () => { quitting = true; if (refreshTimer) clearTimeout(refreshTimer); });
