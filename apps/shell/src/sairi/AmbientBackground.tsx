import { type JSX } from 'react';

/**
 * The ground the work sits on.
 *
 * This used to be three slow-drifting coloured light fields carrying the active
 * context's hue, so switching contexts changed the colour of the room. It was
 * the single most decorative thing in the build and it is gone: paper does not
 * glow, and a moving light behind the text was competing with the text.
 *
 * What remains is deliberately almost nothing — a flat field and a few percent
 * of grain. The grain is not decoration but a technical fix: large flat areas
 * band visibly on 8-bit panels, and noise at this amplitude hides it entirely
 * while being invisible as texture.
 *
 * Switching contexts still has to feel spatial. That now comes from the work
 * itself moving (see `is-switching` in sairi.css), which is the honest place
 * for it — the room is not what changed, the contents are.
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

export function AmbientBackground(): JSX.Element {
  return (
    <div aria-hidden="true" className="s-ambient">
      <span className="s-ambient__grain" style={{ backgroundImage: `url("${GRAIN}")` }} />
    </div>
  );
}
