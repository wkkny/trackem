import type { TrackemApi } from '../electron/contracts';

export type {
  ConfigPayload,
  DiagnosticEntry,
  TrackemApi,
  TrackemConfig,
  UsageSnapshot,
  UsageSnapshotPayload,
  UsageWindow,
} from '../electron/contracts';

declare global {
  interface Window {
    trackem: TrackemApi | undefined;
  }
}
