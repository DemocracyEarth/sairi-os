import type { JSX } from 'react';
import { useT } from '@sairios/ui-components';
import { Icon } from './icons.js';

/**
 * The dock.
 *
 * Navigation, not a launcher. These are the four places the environment can put
 * you — the context map, files, agents, and home — rather than a row of
 * applications to start. Nothing here launches a program.
 */

export type DockTarget = 'home' | 'contexts' | 'files' | 'agents';

export interface DockProps {
  active: DockTarget;
  onSelect: (target: DockTarget) => void;
}

export function Dock({ active, onSelect }: DockProps): JSX.Element {
  const t = useT();

  const items: { id: DockTarget; label: string; icon: JSX.Element }[] = [
    { id: 'home', label: t('dock.home'), icon: <Icon.home size={20} /> },
    { id: 'contexts', label: t('dock.contexts'), icon: <Icon.contexts size={20} /> },
    { id: 'files', label: t('dock.files'), icon: <Icon.folder size={20} /> },
    { id: 'agents', label: t('dock.agents'), icon: <Icon.agents size={20} /> },
  ];

  return (
    <nav aria-label={t('dock.contexts')} className="dock">
      {items.map((item) => (
        <button
          aria-current={active === item.id ? 'page' : undefined}
          className={`dock__item${active === item.id ? ' dock__item--active' : ''}`}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          {item.icon}
          <span className="dock__label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
