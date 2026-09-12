export interface Rect { x: number; y: number; width: number; height: number }

/** Coordinates are display-independent pixels, including negative multi-monitor origins. */
export function popoverBounds(anchor: Rect, workArea: Rect): Rect {
  const width = Math.min(420, workArea.width);
  const height = Math.min(560, workArea.height);
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  return {
    width, height,
    x: Math.round(clamp(anchor.x + anchor.width / 2 - width / 2, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(anchor.y >= workArea.y + workArea.height / 2 ? anchor.y - height - 8 : anchor.y + anchor.height + 8, workArea.y, workArea.y + workArea.height - height)),
  };
}
