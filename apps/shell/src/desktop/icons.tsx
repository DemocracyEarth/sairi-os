import type { JSX } from 'react';

/**
 * The icon set.
 *
 * Thin monochrome line drawings on a 16-unit grid, `currentColor` throughout, no
 * fills and no gradients. They read at 14px in a title bar and at 26px on the
 * desktop without a second asset, and they inherit the theme for free.
 *
 * Deliberately plain: an operating environment whose iconography is louder than
 * its content is a toy. These are signposts, not decoration.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

function svg(size: number, children: JSX.Element, className?: string): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className ?? ''}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.2"
      viewBox="0 0 16 16"
      width={size}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  home: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5Z" />
        <path d="M6.5 13.5v-4h3v4" />
      </>,
      className,
    ),

  /** Stacked planes: several contexts held at once. */
  contexts: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <rect x="2.5" y="2.5" width="8" height="8" rx="1" />
        <path d="M5.5 13.5h7a1 1 0 0 0 1-1v-7" />
      </>,
      className,
    ),

  folder: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <path d="M2 4.5A1 1 0 0 1 3 3.5h3l1.2 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
      </>,
      className,
    ),

  agents: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="6.2" cy="7" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="9.8" cy="7" r="0.6" fill="currentColor" stroke="none" />
        <path d="M5.8 10.2c1.4 1 3 1 4.4 0" />
      </>,
      className,
    ),

  disk: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="8" cy="8" r="1.6" />
        <path d="M8 2.5v2M13.5 8h-2M8 13.5v-2M2.5 8h2" />
      </>,
      className,
    ),

  trash: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <path d="M3 4.5h10M6.5 4.5V3h3v1.5" />
        <path d="M4.2 4.5 5 13a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5l.8-8.5" />
        <path d="M6.8 7v4M9.2 7v4" />
      </>,
      className,
    ),

  /** The context map: a field of contexts seen from above. */
  map: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
        <path d="M2.5 6h11M6 6v7.5" />
      </>,
      className,
    ),

  window: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M2 6h12" />
      </>,
      className,
    ),

  terminal: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
      </>,
      className,
    ),

  /** A processor die: the runtime the environment is standing on. */
  chip: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <rect x="4.5" y="4.5" width="7" height="7" rx="0.8" />
        <path d="M6.5 2.5v2M9.5 2.5v2M6.5 11.5v2M9.5 11.5v2M2.5 6.5h2M2.5 9.5h2M11.5 6.5h2M11.5 9.5h2" />
      </>,
      className,
    ),

  /** Ephemeral: a clock. Bounded work. */
  clock: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5v3.2l2 1.3" />
      </>,
      className,
    ),

  /** Persistent: a lemniscate. Work that keeps going. */
  infinity: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <path d="M5.2 5.6a2.4 2.4 0 1 0 0 4.8c1.4 0 2-1 2.8-2.4S9.4 5.6 10.8 5.6a2.4 2.4 0 1 1 0 4.8c-1.4 0-2-1-2.8-2.4" />
      </>,
      className,
    ),

  /** Crystallized: a faceted solid. A workflow that has set. */
  crystal: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <path d="M8 2.2 13.4 6 11.3 12.6H4.7L2.6 6Z" />
        <path d="M2.6 6h10.8M8 2.2 4.7 12.6M8 2.2l3.3 10.4" />
      </>,
      className,
    ),

  plus: ({ size = 16, className }: IconProps = {}) =>
    svg(size, <path d="M8 3.5v9M3.5 8h9" />, className),

  display: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <rect x="2" y="3" width="12" height="8" rx="1" />
        <path d="M6 13.5h4" />
      </>,
      className,
    ),

  speaker: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <path d="M3 6.2h2.2L8 3.8v8.4L5.2 9.8H3Z" />
        <path d="M10.4 6.4a2.6 2.6 0 0 1 0 3.2" />
      </>,
      className,
    ),

  network: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <circle cx="8" cy="4" r="1.6" />
        <circle cx="3.8" cy="12" r="1.6" />
        <circle cx="12.2" cy="12" r="1.6" />
        <path d="M6.9 5.4 4.6 10.5M9.1 5.4l2.3 5.1M5.4 12h5.2" />
      </>,
      className,
    ),

  globe: ({ size = 16, className }: IconProps = {}) =>
    svg(
      size,
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 8h11M8 2.5c1.6 1.7 2.4 3.5 2.4 5.5S9.6 12.3 8 13.5C6.4 12.3 5.6 10 5.6 8s.8-3.8 2.4-5.5Z" />
      </>,
      className,
    ),

  chevronUp: ({ size = 16, className }: IconProps = {}) =>
    svg(size, <path d="M4.5 9.5 8 6l3.5 3.5" />, className),
};

export type IconName = keyof typeof Icon;
