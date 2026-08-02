import { useId, type JSX } from 'react';

/**
 * The SairiOS logo.
 *
 * Inline SVG rather than an <img>: the shell's Content Security Policy is
 * `img-src 'self' data:`, and while a same-origin file would satisfy it, drawing
 * the mark inline means the desktop has no asset to fetch, nothing to 404, and
 * nothing that can render late and shift the layout. The canonical file lives at
 * os/branding/sairios-logo.svg — the geometry here is that file, and the comment
 * there explains every number.
 *
 * Two variants, because one lockup cannot serve both ends of the size range:
 *
 *   full     the frame, "sairi" and "OS". Legible from about 96px up.
 *   compact  the frame and "sairi" only, scaled to fill it. "OS" at menu-bar
 *            size is four illegible grey pixels that read as dirt, so it is
 *            dropped rather than shrunk.
 *
 * The interior is transparent in both. The logo sits on whatever surface it is
 * given, which is what lets one asset work on the light and dark themes without
 * a second copy.
 */

export type SairiLogoVariant = 'full' | 'compact';

export interface SairiLogoProps {
  /** Rendered edge length in pixels. The artwork is square. */
  size?: number;
  variant?: SairiLogoVariant;
  /**
   * Decorative by default: in almost every placement the word "SairiOS" is
   * already next to it, and a screen reader announcing it twice is noise. Pass a
   * label where the logo stands alone.
   */
  label?: string;
  className?: string;
}

export function SairiLogo({
  size = 64,
  variant = 'full',
  label,
  className,
}: SairiLogoProps): JSX.Element {
  // Gradient ids must be unique per document: the logo renders in the menu bar
  // and in a dialog at the same time, and duplicate ids would make one instance
  // reference the other's gradient. useId's colons are stripped because a raw
  // `url(#:r0:)` is not a reliable reference.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const frame = `sairi-frame-${uid}`;
  const word = `sairi-word-${uid}`;
  const grey = `sairi-os-${uid}`;

  const compact = variant === 'compact';

  return (
    <svg
      aria-hidden={label ? undefined : true}
      className={className}
      fill="none"
      height={size}
      role={label ? 'img' : undefined}
      viewBox="0 0 640 640"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {label && <title>{label}</title>}
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={frame} x1="36" x2="604" y1="0" y2="0">
          <stop offset="0" stopColor="#6EA8E4" />
          <stop offset="0.30" stopColor="#78C6A6" />
          <stop offset="0.53" stopColor="#86D08A" />
          <stop offset="0.74" stopColor="#F0C94F" />
          <stop offset="1" stopColor="#F5A05C" />
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" id={word} x1="116" x2="524" y1="0" y2="0">
          <stop offset="0" stopColor="#6EA8E4" />
          <stop offset="0.28" stopColor="#78C6A6" />
          <stop offset="0.52" stopColor="#86D08A" />
          <stop offset="0.72" stopColor="#F0C94F" />
          <stop offset="1" stopColor="#F5A05C" />
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" id={grey} x1="241" x2="399" y1="0" y2="0">
          <stop offset="0" stopColor="#9C9C9E" />
          <stop offset="1" stopColor="#8B8B87" />
        </linearGradient>
      </defs>

      <rect
        height="560"
        rx="108"
        stroke={`url(#${frame})`}
        strokeWidth={compact ? 14 : 8}
        width="560"
        x="40"
        y="40"
      />

      {/*
        Compact lifts the wordmark to the centre of the frame and enlarges it.
        The gradient is in user space, so scaling about the wordmark's own centre
        (320, 294) keeps every letter the colour it has in the full lockup.
      */}
      <g transform={compact ? 'translate(320 294) scale(1.28) translate(-320 -294)' : undefined}>
        <path
          d="M185 266C185 253 171 246 157 246C143 246 132 254 132 265C132 276 141 282 158 288C177 295 188 303 188 318C188 332 175 342 158 342C144 342 132 335 132 323"
          stroke={`url(#${word})`}
          strokeWidth="30"
        />

        <circle cx="280" cy="294" r="45" stroke={`url(#${word})`} strokeWidth="30" />
        <rect fill={`url(#${word})`} height="120" width="30" x="310" y="234" />

        <rect fill={`url(#${word})`} height="120" width="30" x="356" y="234" />

        <rect fill={`url(#${word})`} height="120" width="30" x="402" y="234" />
        <path
          d="M417 280C418 253 437 249 463 249"
          stroke={`url(#${word})`}
          strokeLinecap="round"
          strokeWidth="30"
        />

        <rect fill={`url(#${word})`} height="120" width="30" x="494" y="234" />

        <circle cx="371" cy="200" fill="#5FC9A0" r="17" />
        <circle cx="509" cy="200" fill="#F4C544" r="17" />
      </g>

      {!compact && (
        <>
          <circle cx="286" cy="435" r="36.5" stroke={`url(#${grey})`} strokeWidth="17" />
          <path
            d="M389 412C389 403 382 398 374 398C366 398 357 403 357 412C357 421 364 426 375 431C386 436 391 442 391 452C391 462 383 468 374 468C365 468 357 463 357 454"
            stroke={`url(#${grey})`}
            strokeWidth="17"
          />
        </>
      )}
    </svg>
  );
}
