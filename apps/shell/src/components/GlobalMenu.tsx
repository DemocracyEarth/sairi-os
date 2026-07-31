import { useEffect, useRef, useState, type JSX } from 'react';

/**
 * The global menu.
 *
 * A single menu bar for the whole environment rather than per-application
 * menus, because there are no applications. The commands act on contexts.
 */

export interface MenuCommand {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface MenuDefinition {
  title: string;
  commands: MenuCommand[];
}

export interface GlobalMenuProps {
  menus: MenuDefinition[];
  status: { label: string; state: 'ok' | 'warn' | 'error' }[];
}

export function GlobalMenu({ menus, status }: GlobalMenuProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu, index) => (
        <div className="menu-anchor" key={menu.title}>
          <button
            aria-expanded={open === menu.title}
            aria-haspopup="menu"
            className={`menubar__item${index === 0 ? ' menubar__item--brand' : ''}`}
            onClick={() => setOpen(open === menu.title ? null : menu.title)}
            type="button"
          >
            {menu.title}
          </button>
          {open === menu.title && (
            <ul className="menu" role="menu">
              {menu.commands.map((command) => (
                <li key={command.label} role="none">
                  {command.separatorBefore && <div className="menu__separator" />}
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
                    {command.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="menubar__spacer" />
      <div className="menubar__status">
        {status.map((item) => (
          <span key={item.label}>
            <span
              className="menubar__status-dot"
              style={{
                background:
                  item.state === 'ok'
                    ? 'var(--sairi-ok)'
                    : item.state === 'warn'
                      ? 'var(--sairi-warn)'
                      : 'var(--sairi-error)',
              }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
