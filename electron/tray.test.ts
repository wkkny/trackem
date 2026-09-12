import { describe, expect, it } from 'vitest';
import { popoverBounds } from './tray';
describe('tray popover positioning', () => {
  it.each([
    { x: 1850, y: 1040, width: 24, height: 40 },
    { x: 0, y: 0, width: 40, height: 24 },
    { x: 0, y: 500, width: 40, height: 24 },
    { x: 1880, y: 500, width: 40, height: 24 },
  ])('clamps to the work area for each taskbar edge: %j', anchor => {
    const bounds = popoverBounds(anchor, { x: 40, y: 40, width: 1840, height: 1000 });
    expect(bounds.x).toBeGreaterThanOrEqual(40); expect(bounds.y).toBeGreaterThanOrEqual(40);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1880); expect(bounds.y + bounds.height).toBeLessThanOrEqual(1040);
  });
  it('supports negative monitor origins and small scaled displays', () => {
    expect(popoverBounds({ x: -50, y: -10, width: 20, height: 20 }, { x: -400, y: -300, width: 400, height: 300 })).toEqual({ x: -400, y: -300, width: 400, height: 300 });
  });
});
