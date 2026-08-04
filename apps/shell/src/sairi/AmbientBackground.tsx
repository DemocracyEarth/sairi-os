import { type CSSProperties, type JSX } from 'react';
import { hue } from './primitives.js';
import type { Spectral } from './state.js';

/**
 * The atmosphere behind everything.
 *
 * Three slow-drifting light fields plus a fine grain. It carries the active
 * context's hue, so switching contexts changes the colour of the room rather
 * than just the contents of a panel — which is most of why a switch feels
 * spatial instead of like a tab change.
 *
 * Deliberately CSS-only. A canvas particle field would cost a permanent
 * main-thread loop for something nobody consciously looks at; three transformed
 * radial gradients cost the compositor almost nothing, keep working when the
 * tab is backgrounded, and stop entirely under prefers-reduced-motion.
 *
 * The grain is an inline SVG turbulence as a data URI. It exists because large
 * flat gradients band badly on 8-bit displays, and a few percent of noise hides
 * it completely — this is the one decorative element here that is really a
 * technical fix.
 */

const GRAIN =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>
       <filter id='n'>
         <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/>
         <feColorMatrix type='saturate' values='0'/>
       </filter>
       <rect width='140' height='140' filter='url(#n)' opacity='0.55'/>
     </svg>`,
  );

export function AmbientBackground({ accent = 'blue' }: { accent?: Spectral }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="s-ambient"
      style={{ '--accent': hue(accent) } as CSSProperties}
    >
      <span className="s-ambient__field s-ambient__field--1" />
      <span className="s-ambient__field s-ambient__field--2" />
      <span className="s-ambient__field s-ambient__field--3" />
      <span className="s-ambient__grain" style={{ backgroundImage: `url("${GRAIN}")` }} />
    </div>
  );
}
