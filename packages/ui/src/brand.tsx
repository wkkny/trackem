import type { SVGProps } from 'react';

/** Provisional capacity-bars mark. Keep geometry aligned with the native template. */
export function TrackemMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true" {...props}>
    <rect x="2" y="3" width="10" height="4" rx="2" />
    <rect x="14" y="3" width="2" height="4" rx="1" />
    <rect x="2" y="11" width="6" height="4" rx="2" />
    <rect x="10" y="11" width="6" height="4" rx="2" />
  </svg>;
}
