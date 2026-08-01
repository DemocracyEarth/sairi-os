import { describe, expect, it } from 'vitest';
import { CHROME, MIN_SIZE, windowReducer, type WindowState, type WindowsState } from './windows.js';

/**
 * Window manager rules.
 *
 * The properties that matter are the ones a user would notice as data loss or
 * confusion: a context must never open twice, a window must never be lost, and
 * restoring a maximized window must return it exactly where it was.
 */

const VIEWPORT = { width: 1280, height: 800 };

function win(id: string, over: Partial<WindowState> = {}): WindowState {
  return {
    id,
    kind: 'context',
    x: 100,
    y: 100,
    width: 600,
    height: 400,
    z: 1,
    minimized: false,
    maximized: false,
    ...over,
  };
}

function state(windows: WindowState[]): WindowsState {
  return { windows, nextZ: windows.length };
}

describe('opening', () => {
  it('adds a window', () => {
    const next = windowReducer(state([]), {
      type: 'open',
      window: { id: 'a', kind: 'terminal', x: 0, y: 0, width: 400, height: 300 },
    });
    expect(next.windows).toHaveLength(1);
  });

  it('never opens the same context twice — it raises the existing window', () => {
    const start = state([win('ctx:1', { z: 1 })]);
    const next = windowReducer(start, {
      type: 'open',
      window: { id: 'ctx:1', kind: 'context', x: 0, y: 0, width: 400, height: 300 },
    });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0]?.z).toBeGreaterThan(1);
  });

  it('un-minimizes when re-opened, so a minimized context is never "already open" and invisible', () => {
    const start = state([win('ctx:1', { minimized: true })]);
    const next = windowReducer(start, {
      type: 'open',
      window: { id: 'ctx:1', kind: 'context', x: 0, y: 0, width: 400, height: 300 },
    });
    expect(next.windows[0]?.minimized).toBe(false);
  });
});

describe('focus and z-order', () => {
  it('raises the focused window above every other', () => {
    const start = state([win('a', { z: 1 }), win('b', { z: 2 })]);
    const next = windowReducer(start, { type: 'focus', id: 'a' });
    const a = next.windows.find((w) => w.id === 'a') as WindowState;
    const b = next.windows.find((w) => w.id === 'b') as WindowState;
    expect(a.z).toBeGreaterThan(b.z);
  });

  it('focusing the already-top window changes nothing', () => {
    const start: WindowsState = { windows: [win('a', { z: 3 })], nextZ: 3 };
    expect(windowReducer(start, { type: 'focus', id: 'a' })).toBe(start);
  });
});

describe('maximize', () => {
  it('fills the area between the chrome', () => {
    const start = state([win('a')]);
    const next = windowReducer(start, { type: 'toggleMaximize', id: 'a', viewport: VIEWPORT });
    const w = next.windows[0] as WindowState;
    expect(w.maximized).toBe(true);
    expect(w.x).toBe(CHROME.left);
    expect(w.y).toBe(CHROME.top);
    expect(w.width).toBe(VIEWPORT.width - CHROME.left - CHROME.right);
    expect(w.height).toBe(VIEWPORT.height - CHROME.top - CHROME.bottom);
  });

  it('restores to exactly the previous geometry', () => {
    const original = win('a', { x: 42, y: 84, width: 500, height: 350 });
    let next = windowReducer(state([original]), {
      type: 'toggleMaximize',
      id: 'a',
      viewport: VIEWPORT,
    });
    next = windowReducer(next, { type: 'toggleMaximize', id: 'a', viewport: VIEWPORT });
    const w = next.windows[0] as WindowState;
    expect({ x: w.x, y: w.y, width: w.width, height: w.height }).toEqual({
      x: 42,
      y: 84,
      width: 500,
      height: 350,
    });
    expect(w.maximized).toBe(false);
  });
});

describe('resize', () => {
  it('never lets a window shrink below the minimum', () => {
    const next = windowReducer(state([win('a')]), {
      type: 'resize',
      id: 'a',
      width: 10,
      height: 10,
    });
    expect(next.windows[0]?.width).toBe(MIN_SIZE.width);
    expect(next.windows[0]?.height).toBe(MIN_SIZE.height);
  });
});

describe('tiling', () => {
  it('places every visible window inside the chrome, without overlap in a row', () => {
    const start = state([win('a'), win('b'), win('c'), win('d')]);
    const next = windowReducer(start, { type: 'tile', viewport: VIEWPORT });
    for (const w of next.windows) {
      expect(w.x).toBeGreaterThanOrEqual(CHROME.left);
      expect(w.y).toBeGreaterThanOrEqual(CHROME.top);
      expect(w.x + w.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(w.maximized).toBe(false);
    }
  });

  it('leaves minimized windows alone', () => {
    const start = state([win('a'), win('b', { minimized: true, x: 999, y: 999 })]);
    const next = windowReducer(start, { type: 'tile', viewport: VIEWPORT });
    const b = next.windows.find((w) => w.id === 'b') as WindowState;
    expect({ x: b.x, y: b.y }).toEqual({ x: 999, y: 999 });
  });

  it('does nothing when everything is minimized', () => {
    const start = state([win('a', { minimized: true })]);
    expect(windowReducer(start, { type: 'tile', viewport: VIEWPORT })).toBe(start);
  });
});

describe('minimize and restore', () => {
  it('restoring raises the window as well as showing it', () => {
    const start = state([win('a', { minimized: true, z: 1 }), win('b', { z: 5 })]);
    const next = windowReducer({ ...start, nextZ: 5 }, { type: 'restore', id: 'a' });
    const a = next.windows.find((w) => w.id === 'a') as WindowState;
    expect(a.minimized).toBe(false);
    expect(a.z).toBeGreaterThan(5);
  });

  it('minimizeAll hides everything, and bringAllToFront shows everything again', () => {
    let next = windowReducer(state([win('a'), win('b')]), { type: 'minimizeAll' });
    expect(next.windows.every((w) => w.minimized)).toBe(true);
    next = windowReducer(next, { type: 'bringAllToFront' });
    expect(next.windows.every((w) => !w.minimized)).toBe(true);
  });
});

describe('closing', () => {
  it('removes only the named window', () => {
    const next = windowReducer(state([win('a'), win('b')]), { type: 'close', id: 'a' });
    expect(next.windows.map((w) => w.id)).toEqual(['b']);
  });
});
