import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSnapshot } from './providers/codex';

interface RecordedTray {
  setContextMenu: ReturnType<typeof vi.fn>;
  setToolTip: ReturnType<typeof vi.fn>;
  popUpContextMenu: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
  trays: [] as RecordedTray[],
  menuTemplates: [] as unknown[][],
  appEvents: new Map<string, () => void>(),
  powerEvents: new Map<string, () => void>(),
  getSnapshot: vi.fn(),
}));

vi.mock('./providers/codex', () => ({ getSnapshot: state.getSnapshot }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Tray extends EventEmitter {
    setContextMenu = vi.fn();
    setToolTip = vi.fn();
    popUpContextMenu = vi.fn();

    constructor() {
      super();
      state.trays.push(this);
    }
  }

  return {
    Tray,
    Menu: {
      buildFromTemplate: (template: unknown[]) => {
        state.menuTemplates.push(template);
        return { template };
      },
    },
    nativeImage: {
      createFromPath: () => ({ resize: () => ({}) }),
    },
    powerMonitor: {
      on: (event: string, callback: () => void) => state.powerEvents.set(event, callback),
    },
    app: {
      isPackaged: false,
      requestSingleInstanceLock: () => true,
      setAppUserModelId: vi.fn(),
      quit: vi.fn(),
      whenReady: () => Promise.resolve(),
      on: (event: string, callback: () => void) => state.appEvents.set(event, callback),
    },
  };
});

function snapshot(): UsageSnapshot {
  return {
    ok: true,
    plan: 'plus',
    updatedAt: new Date().toISOString(),
    windows: {
      fiveHour: { id: 'fiveHour', usedPercent: 10, resetAt: new Date(Date.now() + 3_600_000).toISOString(), windowSeconds: 18_000 },
      weekly: { id: 'weekly', usedPercent: 20, resetAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), windowSeconds: 604_800 },
    },
    bankedResets: 2,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  state.trays.length = 0;
  state.menuTemplates.length = 0;
  state.appEvents.clear();
  state.powerEvents.clear();
  state.getSnapshot.mockReset().mockResolvedValue(snapshot());
  await import('./main');
  await settle();
});

describe('Windows tray lifecycle', () => {
  it('creates a native menu with Codex usage', () => {
    expect(state.trays).toHaveLength(1);
    const labels = state.menuTemplates.flat().flatMap(item => {
      if (item && typeof item === 'object' && 'label' in item) return [(item as { label: string }).label];
      return [];
    });
    expect(labels).toContain('Plan: Plus');
    expect(labels).toContain('Banked resets: 2');
  });

  it('refreshes after resume', async () => {
    state.powerEvents.get('resume')?.();
    await settle();
    expect(state.getSnapshot).toHaveBeenCalledTimes(2);
  });
});
