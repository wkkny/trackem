import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { UsageSnapshot } from './providers/codex';
import { DEFAULT_CONFIG } from './config';

const originalPlatform = process.platform;
const state = vi.hoisted(() => ({ windows: [] as any[], trays: [] as any[], notifications: [] as any[], handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>(), power: new Map<string, () => void>(), getCodex: vi.fn(), getClaude: vi.fn(), studyOpen: vi.fn(), nativeOptions: null as null | { action(action: string): void; failed(): void; ready(): void }, nativeUpdate: vi.fn(), nativeStop: vi.fn() }));
vi.mock('./trays/macos', () => ({ createMacOSTray: (options: typeof state.nativeOptions) => { state.nativeOptions = options; return { update: state.nativeUpdate, stop: state.nativeStop }; } }));
vi.mock('./providers/codex', () => ({ getSnapshots: state.getCodex }));
vi.mock('./providers/claude', () => ({ getClaudeSnapshot: state.getClaude }));
vi.mock('./config', async importOriginal => {
  const original = await importOriginal<typeof import('./config')>();
  return { ...original, loadConfig: () => ({ ...original.DEFAULT_CONFIG }), saveConfig: (_file: string, value: unknown) => original.normalizeConfig(value) };
});
vi.mock('./research', () => ({ LocalResearch: class { recordOpen = state.studyOpen; setEnabled = vi.fn(); report = () => ({}); } }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    visible = false;
    options: any;
    url = '';
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), getURL: () => this.url, setWindowOpenHandler: vi.fn(), session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } });
    constructor(options: any) { super(); this.options = options; state.windows.push(this); }
    loadFile = vi.fn(async (file: string, options: { query: { view: string } }) => { this.url = pathToFileURL(file).href + '?view=' + options.query.view; }); loadURL = vi.fn(async (url: string) => { this.url = url; }); isDestroyed = () => false;
    show = vi.fn(() => { this.visible = true; }); hide = vi.fn(() => { this.visible = false; });
    focus = vi.fn(); isVisible = () => this.visible;
    setAlwaysOnTop = vi.fn(); setResizable = vi.fn(); setMinimumSize = vi.fn(); setSize = vi.fn(); setBounds = vi.fn(); center = vi.fn();
  }
  class Tray extends EventEmitter {
    constructor(..._args: any[]) { super(); state.trays.push(this); }
    destroy = vi.fn(); setToolTip = vi.fn(); popUpContextMenu = vi.fn(); getBounds = () => ({ x: 1900, y: 1040, width: 20, height: 40 });
  }
  class Notification extends EventEmitter {
    static isSupported = () => true;
    show = vi.fn();
    constructor(public options: unknown) { super(); state.notifications.push(this); }
  }
  return {
    BrowserWindow: Window, Tray, Notification,
    app: { setName: vi.fn(), setPath: vi.fn(), requestSingleInstanceLock: () => true, quit: vi.fn(), dock: { hide: vi.fn() }, isPackaged: true, setAppUserModelId: vi.fn(), getVersion: () => '0.0.0-test', whenReady: () => Promise.resolve(), getPath: () => '/test', getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: vi.fn(), on: (event: string, callback: any) => state.events.set(event, callback) },
    ipcMain: { handle: (key: string, callback: any) => state.handlers.set(key, callback), on: (key: string, callback: any) => state.events.set(key, callback) },
    powerMonitor: { on: (key: string, callback: () => void) => state.power.set(key, callback) },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    Menu: { buildFromTemplate: (template: any) => template },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false, resize: vi.fn(), setTemplateImage: vi.fn() }),
      createEmpty: () => ({ isEmpty: () => true, resize: vi.fn(), setTemplateImage: vi.fn() }),
    },
    clipboard: { writeText: vi.fn() },
  };
});

function snapshot(): UsageSnapshot {
  return { ok: true, providerId: 'codex', account: { id: 'test', label: 'private@example.com', email: null, home: '/test', isDefault: true }, plan: 'plus', source: '/test/auth.json', updatedAt: new Date().toISOString(), windows: { fiveHour: { id: 'fiveHour', usedPercent: 95, resetAt: new Date(Date.now() + 3600_000).toISOString(), windowSeconds: 18_000 } }, reserve: null, topModel: null };
}
function ipcEvent() { return { sender: state.windows[0].webContents }; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.join(__dirname, 'resources'), configurable: true });
  state.nativeOptions = null; state.nativeUpdate.mockClear(); state.nativeStop.mockClear();
  state.windows.length = 0; state.trays.length = 0; state.notifications.length = 0;
  state.handlers.clear(); state.events.clear(); state.power.clear(); state.studyOpen.mockClear();
  state.getCodex.mockReset().mockResolvedValue([snapshot()]);
  state.getClaude.mockReset().mockResolvedValue({ ...snapshot(), providerId: 'claude', ok: false, windows: {} });
  await import('./main'); await settle();
});
afterEach(() => { state.events.get('before-quit')?.(); vi.useRealTimers(); Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true }); });

describe('desktop lifecycle', () => {
  it('does not show or record a dashboard until its renderer is ready', () => {
    expect(state.windows[0].visible).toBe(false);
    expect(state.studyOpen).not.toHaveBeenCalled();
    state.windows[0].emit('ready-to-show');
    expect(state.windows[0].visible).toBe(true);
    expect(state.studyOpen).toHaveBeenCalledTimes(1);
  });
  it('keeps the Windows tray window separate from the dashboard', () => {
    const dashboard = state.windows[0];
    expect(state.windows).toHaveLength(1);
    state.trays[0].emit('click');
    const popover = state.windows[1];
    for (const window of state.windows) expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true });
    expect(popover.setBounds).toHaveBeenCalledWith({ x: 1500, y: 472, width: 420, height: 560 });
    expect(dashboard.setBounds).not.toHaveBeenCalled();
    popover.emit('ready-to-show');
    expect(popover.visible).toBe(true);
    expect(state.handlers.get('usage:get')?.({ sender: popover.webContents })).not.toHaveProperty('view');
    expect(state.handlers.get('usage:get')?.({ sender: popover.webContents })).toMatchObject({ appVersion: '0.0.0-test' });
    popover.emit('blur');
    expect(popover.visible).toBe(false);
    state.events.get('window:dashboard')?.({ sender: popover.webContents });
    dashboard.emit('ready-to-show');
    expect(dashboard.visible).toBe(true);
    expect(state.windows).toHaveLength(2);
  });
  it('uses the Swift helper on macOS and routes its actions', async () => {
    state.events.get('before-quit')?.();
    state.windows.length = 0; state.trays.length = 0;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.resetModules(); await import('./main'); await settle();
    expect(state.trays).toHaveLength(0);
    expect(state.nativeUpdate).toHaveBeenCalled();
    state.nativeOptions?.action('settings');
    expect(state.handlers.get('window:page')?.(ipcEvent())).toBe('Settings');
    expect(state.windows).toHaveLength(1);
    state.nativeOptions?.failed();
    expect(state.trays).toHaveLength(1);
    state.nativeOptions?.ready();
    expect(state.trays[0].destroy).toHaveBeenCalled();
    state.events.get('before-quit')?.();
    expect(state.nativeStop).toHaveBeenCalled();
  });
  it('creates no renderer on a hidden login launch', async () => {
    state.events.get('before-quit')?.();
    state.windows.length = 0;
    process.argv.push('--hidden');
    try {
      vi.resetModules(); await import('./main'); await settle();
      expect(state.windows).toHaveLength(0);
      state.events.get('second-instance')?.();
      expect(state.windows).toHaveLength(1);
    } finally { process.argv.splice(process.argv.lastIndexOf('--hidden'), 1); }
  });
  it('rejects a trusted webContents at the wrong URL and a child frame', () => {
    const window = state.windows[0];
    const originalURL = window.url;
    window.url = 'https://example.com';
    expect(() => state.handlers.get('usage:get')?.(ipcEvent())).toThrow('untrusted renderer');
    window.url = originalURL;
    expect(() => state.handlers.get('usage:get')?.({ ...ipcEvent(), senderFrame: {} })).toThrow('untrusted renderer');
  });
  it('deduplicates warnings within a reset window and omits account identity', async () => {
    expect(state.notifications).toHaveLength(1);
    expect(JSON.stringify(state.notifications[0].options)).not.toContain('private@example.com');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(state.notifications).toHaveLength(1);
  });
  it('coalesces concurrent manual refreshes', async () => {
    let resolve!: (value: UsageSnapshot[]) => void;
    state.getCodex.mockReturnValue(new Promise<UsageSnapshot[]>(done => { resolve = done; }));
    const refresh = state.handlers.get('usage:refresh')!;
    const first = refresh(ipcEvent()); const second = refresh(ipcEvent());
    expect(state.getCodex).toHaveBeenCalledTimes(2);
    resolve([snapshot()]); await Promise.all([first, second]);
    expect(state.getCodex).toHaveBeenCalledTimes(2);
  });
  it('lets the tray menu refresh immediately after another attempt', async () => {
    state.trays[0].emit('right-click');
    const menu = state.trays[0].popUpContextMenu.mock.calls[0][0];
    menu[1].click();
    await settle();
    expect(state.getCodex).toHaveBeenCalledTimes(2);
  });
  it('stops polling while suspended and refreshes after resume', async () => {
    state.power.get('suspend')?.();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(state.getCodex).toHaveBeenCalledTimes(1);
    state.power.get('resume')?.(); await settle();
    expect(state.getCodex).toHaveBeenCalledTimes(2);
  });
  it('stops reading disabled providers and clears their displayed data', async () => {
    await state.handlers.get('config:set')!(ipcEvent(), { ...DEFAULT_CONFIG, codexEnabled: false, claudeEnabled: false });
    expect(state.getCodex).toHaveBeenCalledTimes(1); expect(state.getClaude).toHaveBeenCalledTimes(1);
    expect(state.handlers.get('usage:get')!(ipcEvent())).toMatchObject({ codex: [], claude: [] });
  });

  it('rejects IPC from an untrusted renderer', () => {
    expect(() => state.handlers.get('usage:get')?.({ sender: { getURL: () => 'https://example.com' } })).toThrow('untrusted renderer');
  });
});
