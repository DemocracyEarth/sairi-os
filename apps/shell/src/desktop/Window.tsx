import { useCallback, useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useT } from '@sairios/ui-components';
import { CHROME, MIN_SIZE, type Viewport, type WindowState } from './windows.js';

/**
 * Window chrome: title bar, drag, resize, and the three controls.
 *
 * Dragging uses pointer capture rather than document-level mousemove listeners,
 * so a fast drag that outruns the cursor does not drop the window, and a pointer
 * that leaves the viewport still delivers the release.
 *
 * A window is never allowed to move fully off-screen. Losing a context behind
 * the edge of the desktop with no way back would be a data-loss bug wearing a
 * cosmetic disguise.
 */

export interface WindowFrameProps {
  window: WindowState;
  viewport: Viewport;
  focused: boolean;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: { label: string; tone: 'ephemeral' | 'persistent' | 'crystallized' } | undefined;
  /** Small muted text on the right of the title bar: lifecycle or agent state. */
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
}

/** Keeps at least this much of the title bar reachable at every edge. */
const KEEP_VISIBLE = 96;

export function WindowFrame(props: WindowFrameProps): JSX.Element {
  const t = useT();
  const { window: win, viewport } = props;
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    w: number;
    h: number;
  } | null>(null);

  const clampPosition = useCallback(
    (x: number, y: number) => ({
      x: Math.min(
        Math.max(x, CHROME.left - win.width + KEEP_VISIBLE),
        viewport.width - KEEP_VISIBLE,
      ),
      y: Math.min(Math.max(y, CHROME.top), viewport.height - CHROME.bottom - 28),
    }),
    [viewport.height, viewport.width, win.width],
  );

  const onTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Controls live inside the title bar; clicking one must not start a drag.
      if ((event.target as HTMLElement).closest('button')) return;
      props.onFocus();
      if (win.maximized) return;
      dragRef.current = {
        pointerId: event.pointerId,
        dx: event.clientX - win.x,
        dy: event.clientY - win.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [props, win.maximized, win.x, win.y],
  );

  const onTitlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = clampPosition(event.clientX - drag.dx, event.clientY - drag.dy);
      props.onMove(next.x, next.y);
    },
    [clampPosition, props],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }, []);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      props.onFocus();
      resizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        w: win.width,
        h: win.height,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [props, win.height, win.width],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const maxWidth = viewport.width - CHROME.right - win.x;
      const maxHeight = viewport.height - CHROME.bottom - win.y;
      props.onResize(
        Math.min(Math.max(MIN_SIZE.width, resize.w + (event.clientX - resize.startX)), maxWidth),
        Math.min(Math.max(MIN_SIZE.height, resize.h + (event.clientY - resize.startY)), maxHeight),
      );
    },
    [props, viewport.height, viewport.width, win.x, win.y],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
  }, []);

  // A window that was dragged near an edge before the viewport shrank would be
  // stranded; pull it back whenever the desktop resizes.
  useEffect(() => {
    const next = clampPosition(win.x, win.y);
    if (next.x !== win.x || next.y !== win.y) props.onMove(next.x, next.y);
  }, [viewport.width, viewport.height]);

  if (win.minimized) return <></>;

  return (
    <section
      aria-label={props.title}
      className={`win${props.focused ? ' win--focused' : ''}`}
      onPointerDown={props.onFocus}
      style={{ left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.z }}
    >
      <div
        className="win__titlebar"
        onDoubleClick={props.onToggleMaximize}
        onPointerCancel={endDrag}
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={endDrag}
      >
        <span className="win__icon" aria-hidden="true">
          {props.icon}
        </span>
        <h2 className="win__title">{props.title}</h2>
        {props.subtitle && <span className="win__subtitle">{props.subtitle}</span>}
        {props.badge && (
          <span className={`badge badge--${props.badge.tone}`}>{props.badge.label}</span>
        )}
        {props.meta && <span className="win__meta">{props.meta}</span>}
        <span className="win__spacer" />
        <div className="win__controls">
          <button
            aria-label={t('window.minimize')}
            className="win__control"
            onClick={props.onMinimize}
            title={t('window.minimize')}
            type="button"
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <line x1="2.5" y1="6.5" x2="9.5" y2="6.5" />
            </svg>
          </button>
          <button
            aria-label={win.maximized ? t('window.restore') : t('window.maximize')}
            className="win__control"
            onClick={props.onToggleMaximize}
            title={win.maximized ? t('window.restore') : t('window.maximize')}
            type="button"
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <rect x="2.5" y="2.5" width="7" height="7" />
            </svg>
          </button>
          <button
            aria-label={t('window.close')}
            className="win__control win__control--close"
            onClick={props.onClose}
            title={t('window.close')}
            type="button"
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </button>
        </div>
      </div>

      <div className="win__body">{props.children}</div>
      {props.footer && <div className="win__footer">{props.footer}</div>}

      {!win.maximized && (
        <div
          aria-hidden="true"
          className="win__resize"
          onPointerCancel={endResize}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
        />
      )}
    </section>
  );
}
