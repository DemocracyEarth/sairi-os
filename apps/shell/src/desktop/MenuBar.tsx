import { useEffect, useRef, useState, type JSX } from 'react';
import { useT } from '@sairios/ui-components';
import { Icon } from './icons.js';

/**
 * The global menu bar.
 *
 * One menu bar for the whole environment rather than one per application,
 * because there are no applications. Every command here acts on contexts, on
 * windows, or on the environment itself.
 */

export interface MenuCommand {
  label: string;
  onSelect?: (() => void) | undefined;
  disabled?: boolean;
  separatorBefore?: boolean;
  /** Renders a tick to the left. Used for the theme and language choices. */
  checked?: boolean;
  heading?: string;
}

export interface MenuDefinition {
  id: string;
  title: string;
  commands: MenuCommand[];
}

export interface TrayService {
  label: string;
  state: 'ok' | 'warn' | 'error' | 'idle';
}

export interface MenuBarProps {
  menus: MenuDefinition[];
  services: TrayService[];
  onOpenSystemStatus: () => void;
}

export function MenuBar({ menus, services, onOpenSystemStatus }: MenuBarProps): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const barRef = useRef<HTMLDivElement>(null);

  // A desktop with a frozen clock looks broken. Tick on the minute boundary
  // rather than every second: nothing here shows seconds.
  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (!barRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const worst = services.some((s) => s.state === 'error')
    ? 'error'
    : services.some((s) => s.state === 'warn')
      ? 'warn'
      : services.every((s) => s.state === 'ok')
        ? 'ok'
        : 'idle';

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu, index) => (
        <div className="menu-anchor" key={menu.id}>
          <button
            aria-expanded={open === menu.id}
            aria-haspopup="menu"
            className={`menubar__item${index === 0 ? ' menubar__item--brand' : ''}`}
            onClick={() => setOpen(open === menu.id ? null : menu.id)}
            // Hovering across the bar with a menu open switches menus, which is
            // what every desktop does and what hands expect.
            onPointerEnter={() => open && setOpen(menu.id)}
            type="button"
          >
            {menu.title}
          </button>
          {open === menu.id && (
            <ul className="menu" role="menu">
              {menu.commands.map((command, i) => (
                <li key={`${command.label}-${i}`} role="none">
                  {command.separatorBefore && <div className="menu__separator" role="separator" />}
                  {command.heading && <div className="menu__heading">{command.heading}</div>}
                  <button
                    className="menu__item"
                    disabled={command.disabled === true || !command.onSelect}
                    onClick={() => {
                      setOpen(null);
                      command.onSelect?.();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span aria-hidden="true" className="menu__check">
                      {command.checked ? '✓' : ''}
                    </span>
                    {command.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="menubar__spacer" />

      <div className="menubar__tray">
        <button
          aria-label={t('menu.systemStatus')}
          className="menubar__trayitem"
          onClick={onOpenSystemStatus}
          title={services.map((s) => `${s.label}: ${s.state}`).join('\n')}
          type="button"
        >
          <span className={`dot dot--${worst}`} style={{ marginRight: 5 }} />
          <Icon.chip size={14} />
        </button>
        <span className="menubar__trayitem" aria-hidden="true">
          <Icon.display size={14} />
        </span>
        <span className="menubar__trayitem" aria-hidden="true">
          <Icon.speaker size={14} />
        </span>
        <span className="menubar__trayitem" aria-hidden="true">
          <Icon.network size={14} />
        </span>
        <time className="menubar__clock" dateTime={now.toISOString()}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
    </div>
  );
}
