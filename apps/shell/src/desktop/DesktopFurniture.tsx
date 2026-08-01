import type { JSX, ReactNode } from 'react';
import { useT } from '@sairios/ui-components';
import { Icon } from './icons.js';

/**
 * Desktop furniture: the icons on the surface, the status bar, and the system
 * status panel.
 *
 * The desktop icons are honest about what they are. `proyectos` and `disco local`
 * open the sandbox and the data directory as file contexts; they are not
 * decoration standing in for a filesystem SairiOS does not have.
 */

export interface DesktopIconsProps {
  onOpen: (target: 'projects' | 'disk' | 'trash') => void;
}

export function DesktopIcons({ onOpen }: DesktopIconsProps): JSX.Element {
  const t = useT();
  const items = [
    { id: 'projects' as const, label: t('desktop.projects'), icon: <Icon.folder size={26} /> },
    { id: 'disk' as const, label: t('desktop.localDisk'), icon: <Icon.disk size={26} /> },
    { id: 'trash' as const, label: t('desktop.trash'), icon: <Icon.trash size={26} /> },
  ];

  return (
    <div className="deskicons">
      {items.map((item) => (
        <button
          className="deskicon"
          key={item.id}
          onDoubleClick={() => onOpen(item.id)}
          type="button"
        >
          {item.icon}
          <span className="deskicon__label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface TaskEntry {
  id: string;
  label: string;
}

export interface StatusBarProps {
  version: string;
  minimized: TaskEntry[];
  onRestore: (id: string) => void;
  children?: ReactNode;
}

export function StatusBar({
  version,
  minimized,
  onRestore,
  children,
}: StatusBarProps): JSX.Element {
  return (
    <div className="statusbar">
      <span>SairiOS {version}</span>
      {minimized.map((task) => (
        <button
          className="statusbar__task"
          key={task.id}
          onClick={() => onRestore(task.id)}
          type="button"
        >
          {task.label}
        </button>
      ))}
      <span className="statusbar__spacer" />
      {children}
    </div>
  );
}

export interface SystemStatusProps {
  runtime: string;
  model: string;
  memoryActive: boolean;
  /** 0..1. Fraction of the retained event budget currently in use. */
  memoryUsed: number;
  services: { label: string; state: 'ok' | 'warn' | 'error' | 'idle' }[];
}

export function SystemStatus(props: SystemStatusProps): JSX.Element {
  const t = useT();
  const percent = Math.round(Math.min(1, Math.max(0, props.memoryUsed)) * 100);

  return (
    <div className="sysstat">
      <div className="sysstat__row">
        <span className="sysstat__key">{t('sys.runtime')}</span>
        <span className="sysstat__value">{props.runtime}</span>
      </div>
      <div className="sysstat__row">
        <span className="sysstat__key">{t('sys.model')}</span>
        <span className="sysstat__value">{props.model}</span>
      </div>
      <div className="sysstat__row">
        <span className="sysstat__key">{t('sys.memory')}</span>
        <span className="sysstat__value">{props.memoryActive ? t('sys.memoryActive') : '—'}</span>
      </div>
      <div>
        <div
          aria-label={t('sys.memory')}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          className="sysstat__meter"
          role="progressbar"
        >
          <div className="sysstat__fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="sysstat__services">
        {props.services.map((service) => (
          <span className="sysstat__service" key={service.label}>
            <span className={`dot dot--${service.state}`} />
            {service.label}
          </span>
        ))}
      </div>
    </div>
  );
}
