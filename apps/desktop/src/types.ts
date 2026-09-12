import type { TrackemApi } from '@trackem/contracts';

export type {
  ConfigPayload,
  DiagnosticEntry,
  TrackemApi,
  TrackemConfig,
  UsageSnapshot,
  UsageSnapshotPayload,
  UsageWindow,
} from '@trackem/contracts';

declare global {
  interface Window {
    trackem: TrackemApi | undefined;
  }
}
