import { useCallback, useMemo, useReducer } from 'react';

/**
 * The window manager.
 *
 * SairiOS's claim is that every window is a context, which only means something
 * if several contexts can be open at once, side by side, each showing its own
 * state. That is what this manages.
 *
 * It is an IN-SHELL window manager: windows are elements, not surfaces owned by
 * a Wayland compositor. For the current milestone the shell runs fullscreen in a
 * kiosk compositor (`cage`), so it is the only thing on screen and this is the
 * whole desktop. Moving to real per-context native surfaces is a later milestone;
 * keeping the model here — id, geometry, z-order, focus — is what makes that
 * migration a change of backend rather than a rewrite.
 */

export type WindowKind = 'context-map' | 'context' | 'terminal' | 'system-status';

export interface WindowState {
  id: string;
  kind: WindowKind;
  /** Set for `context` windows. The window IS the context. */
  contextId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
  /** Remembers the pre-maximize geometry so restore is exact. */
  maximized: boolean;
  restore?: { x: number; y: number; width: number; height: number };
}

export interface Viewport {
  width: number;
  height: number;
}

/** Chrome insets: menu bar on top, dock on the left, status bar at the bottom. */
export const CHROME = { top: 30, left: 88, right: 8, bottom: 24 } as const;

export const MIN_SIZE = { width: 320, height: 200 } as const;

const DEFAULT_SIZE: Record<WindowKind, { width: number; height: number }> = {
  'context-map': { width: 560, height: 540 },
  context: { width: 720, height: 430 },
  terminal: { width: 520, height: 240 },
  'system-status': { width: 300, height: 150 },
};

type Action =
  | { type: 'open'; window: Omit<WindowState, 'z' | 'minimized' | 'maximized'> }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'resize'; id: string; width: number; height: number }
  | { type: 'minimize'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'toggleMaximize'; id: string; viewport: Viewport }
  | { type: 'minimizeAll' }
  | { type: 'bringAllToFront' }
  | { type: 'tile'; viewport: Viewport };

export interface WindowsState {
  windows: WindowState[];
  nextZ: number;
}

function topZ(state: WindowsState): number {
  return state.nextZ + 1;
}

function reducer(state: WindowsState, action: Action): WindowsState {
  switch (action.type) {
    case 'open': {
      const existing = state.windows.find((w) => w.id === action.window.id);
      if (existing) {
        // Opening something already open raises and un-minimizes it rather than
        // creating a duplicate. Two windows for one context would break the
        // "the window is the context" equivalence.
        return {
          nextZ: topZ(state),
          windows: state.windows.map((w) =>
            w.id === action.window.id ? { ...w, z: topZ(state), minimized: false } : w,
          ),
        };
      }
      return {
        nextZ: topZ(state),
        windows: [
          ...state.windows,
          { ...action.window, z: topZ(state), minimized: false, maximized: false },
        ],
      };
    }

    case 'close':
      return { ...state, windows: state.windows.filter((w) => w.id !== action.id) };

    case 'focus':
      if (state.windows.find((w) => w.id === action.id)?.z === state.nextZ) return state;
      return {
        nextZ: topZ(state),
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, z: topZ(state), minimized: false } : w,
        ),
      };

    case 'move':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, x: action.x, y: action.y } : w,
        ),
      };

    case 'resize':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id
            ? {
                ...w,
                width: Math.max(MIN_SIZE.width, action.width),
                height: Math.max(MIN_SIZE.height, action.height),
              }
            : w,
        ),
      };

    case 'minimize':
      return {
        ...state,
        windows: state.windows.map((w) => (w.id === action.id ? { ...w, minimized: true } : w)),
      };

    case 'restore':
      return {
        nextZ: topZ(state),
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, minimized: false, z: topZ(state) } : w,
        ),
      };

    case 'toggleMaximize': {
      const { viewport } = action;
      return {
        nextZ: topZ(state),
        windows: state.windows.map((w) => {
          if (w.id !== action.id) return w;
          if (w.maximized && w.restore) {
            return { ...w, ...w.restore, maximized: false, z: topZ(state) };
          }
          return {
            ...w,
            restore: { x: w.x, y: w.y, width: w.width, height: w.height },
            x: CHROME.left,
            y: CHROME.top,
            width: viewport.width - CHROME.left - CHROME.right,
            height: viewport.height - CHROME.top - CHROME.bottom,
            maximized: true,
            z: topZ(state),
          };
        }),
      };
    }

    case 'minimizeAll':
      return { ...state, windows: state.windows.map((w) => ({ ...w, minimized: true })) };

    case 'bringAllToFront':
      return { ...state, windows: state.windows.map((w) => ({ ...w, minimized: false })) };

    case 'tile': {
      const visible = state.windows.filter((w) => !w.minimized);
      if (visible.length === 0) return state;
      const columns = Math.ceil(Math.sqrt(visible.length));
      const rows = Math.ceil(visible.length / columns);
      const areaWidth = action.viewport.width - CHROME.left - CHROME.right;
      const areaHeight = action.viewport.height - CHROME.top - CHROME.bottom;
      const cellWidth = Math.floor(areaWidth / columns);
      const cellHeight = Math.floor(areaHeight / rows);
      let index = 0;
      return {
        ...state,
        windows: state.windows.map((w) => {
          if (w.minimized) return w;
          const column = index % columns;
          const row = Math.floor(index / columns);
          index += 1;
          return {
            ...w,
            x: CHROME.left + column * cellWidth,
            y: CHROME.top + row * cellHeight,
            width: Math.max(MIN_SIZE.width, cellWidth - 8),
            height: Math.max(MIN_SIZE.height, cellHeight - 8),
            maximized: false,
          };
        }),
      };
    }

    default:
      return state;
  }
}

/**
 * Places a new window so it does not land exactly on top of the last one.
 * Cascading is the cheapest way to make "several contexts are open" legible.
 */
function cascade(count: number, size: { width: number; height: number }, viewport: Viewport) {
  const step = 26;
  const offset = (count % 6) * step;
  const maxX = Math.max(CHROME.left, viewport.width - size.width - CHROME.right);
  const maxY = Math.max(CHROME.top, viewport.height - size.height - CHROME.bottom);
  return {
    x: Math.min(CHROME.left + 24 + offset, maxX),
    y: Math.min(CHROME.top + 20 + offset, maxY),
  };
}

export interface WindowManager {
  windows: WindowState[];
  focusedId: string | null;
  open: (input: { id: string; kind: WindowKind; contextId?: string }, viewport: Viewport) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, width: number, height: number) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string, viewport: Viewport) => void;
  minimizeAll: () => void;
  bringAllToFront: () => void;
  tile: (viewport: Viewport) => void;
  isOpen: (id: string) => boolean;
}

export function useWindowManager(initial: WindowState[] = []): WindowManager {
  const [state, dispatch] = useReducer(reducer, {
    windows: initial,
    nextZ: initial.length,
  });

  const open = useCallback(
    (input: { id: string; kind: WindowKind; contextId?: string }, viewport: Viewport) => {
      const size = DEFAULT_SIZE[input.kind];
      const position = cascade(state.windows.length, size, viewport);
      dispatch({
        type: 'open',
        window: {
          id: input.id,
          kind: input.kind,
          ...(input.contextId ? { contextId: input.contextId } : {}),
          ...position,
          ...size,
        },
      });
    },
    [state.windows.length],
  );

  const focusedId = useMemo(() => {
    const visible = state.windows.filter((w) => !w.minimized);
    if (visible.length === 0) return null;
    return visible.reduce((top, w) => (w.z > top.z ? w : top), visible[0] as WindowState).id;
  }, [state.windows]);

  return {
    windows: state.windows,
    focusedId,
    open,
    close: useCallback((id) => dispatch({ type: 'close', id }), []),
    focus: useCallback((id) => dispatch({ type: 'focus', id }), []),
    move: useCallback((id, x, y) => dispatch({ type: 'move', id, x, y }), []),
    resize: useCallback((id, width, height) => dispatch({ type: 'resize', id, width, height }), []),
    minimize: useCallback((id) => dispatch({ type: 'minimize', id }), []),
    restore: useCallback((id) => dispatch({ type: 'restore', id }), []),
    toggleMaximize: useCallback(
      (id, viewport) => dispatch({ type: 'toggleMaximize', id, viewport }),
      [],
    ),
    minimizeAll: useCallback(() => dispatch({ type: 'minimizeAll' }), []),
    bringAllToFront: useCallback(() => dispatch({ type: 'bringAllToFront' }), []),
    tile: useCallback((viewport) => dispatch({ type: 'tile', viewport }), []),
    isOpen: useCallback((id) => state.windows.some((w) => w.id === id), [state.windows]),
  };
}

export { reducer as windowReducer };
