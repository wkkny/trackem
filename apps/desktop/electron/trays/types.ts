import type { UsageSnapshotPayload } from "@trackem/contracts";

export interface TrayHost {
	update(payload: UsageSnapshotPayload): void;
	stop(): void;
}
export interface TrayActions {
	dashboard(): void;
	settings(): void;
	refresh(): void;
	quit(): void;
	opened(): void;
	retry(): void;
	togglePopover(anchor: Electron.Rectangle): void;
}
