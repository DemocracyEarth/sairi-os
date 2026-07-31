import type { JSX, ReactNode } from 'react';
import type {
  ActionButtonProps,
  ActivityLogProps,
  ChecklistProps,
  ComponentSpec,
  ContextMetadataProps,
  EditorProps,
  FileListProps,
  KeyValueListProps,
  MarkdownProps,
  PermissionRequestProps,
  ProgressProps,
  SourceListProps,
  StatusPanelProps,
  TableProps,
  TerminalOutputProps,
  TextProps,
  TimelineProps,
} from '@sairios/adaptive-ui-schema';
import { renderMarkdown } from './markdown.js';
import { useHost } from './host.js';

/**
 * The rendered component catalog.
 *
 * One function per audited component type. There is no dynamic component
 * lookup by string outside the single switch in `renderComponent`, and no
 * component receives raw HTML.
 */

function Panel({
  title,
  kind,
  children,
}: {
  title?: string | undefined;
  kind?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="sairi-panel">
      {(title || kind) && (
        <header className="sairi-panel__header">
          <h3 className="sairi-panel__title">{title ?? ''}</h3>
          {kind && <span className="sairi-panel__kind">{kind}</span>}
        </header>
      )}
      <div className="sairi-panel__body">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="sairi-empty">{children}</p>;
}

// --- model-content components ---------------------------------------------

function TextView({ props }: { props: TextProps }): JSX.Element {
  const tone = props.tone ?? 'normal';
  return (
    <Panel title={props.title} kind="text">
      <p className={`sairi-text sairi-text--${tone}`}>{props.body}</p>
    </Panel>
  );
}

function MarkdownView({ props }: { props: MarkdownProps }): JSX.Element {
  return (
    <Panel title={props.title} kind="markdown">
      {renderMarkdown(props.source)}
    </Panel>
  );
}

function SourceListView({ props }: { props: SourceListProps }): JSX.Element {
  return (
    <Panel title={props.title ?? 'Sources'} kind="source-list">
      {props.sources.length === 0 ? (
        <Empty>No sources yet.</Empty>
      ) : (
        <ul className="sairi-list">
          {props.sources.map((source, i) => (
            <li className="sairi-list__row" key={`${source.label}-${i}`}>
              <div className="sairi-source">
                <span className="sairi-source__label">
                  <span className="sairi-source__kind">{source.kind}</span>
                  {source.label}
                  {/* Anything the user did not author is marked, every time. */}
                  {source.trusted !== true && <span className="sairi-untrusted">untrusted</span>}
                </span>
                {source.detail && <span className="sairi-source__detail">{source.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function KeyValueListView({ props }: { props: KeyValueListProps }): JSX.Element {
  return (
    <Panel title={props.title} kind="key-value-list">
      {props.items.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <ul className="sairi-list">
          {props.items.map((item, i) => (
            <li className="sairi-list__row" key={`${item.key}-${i}`}>
              <span className="sairi-list__label">{item.key}</span>
              <span className="sairi-list__value">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EditorView({ regionId, props }: { regionId: string; props: EditorProps }): JSX.Element {
  const host = useHost();
  return (
    <Panel title={props.title ?? 'Document'} kind="editor">
      <textarea
        aria-label={props.title ?? 'Editable document'}
        className="sairi-editor"
        defaultValue={props.value}
        onChange={(event) => host.onEditorChange?.(regionId, event.target.value)}
        placeholder={props.placeholder ?? ''}
        readOnly={props.readOnly ?? false}
        spellCheck={false}
      />
    </Panel>
  );
}

function TableView({ props }: { props: TableProps }): JSX.Element {
  return (
    <Panel title={props.title} kind="table">
      {props.caption && <p className="sairi-table__caption">{props.caption}</p>}
      {props.rows.length === 0 ? (
        <Empty>No rows yet.</Empty>
      ) : (
        <div className="sairi-table-wrap">
          <table className="sairi-table">
            <thead>
              <tr>
                {props.columns.map((column) => (
                  <th className={alignClass(column.align)} key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, i) => (
                <tr key={`row-${i}`}>
                  {props.columns.map((column) => (
                    <td className={alignClass(column.align)} key={column.key}>
                      {formatCell(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function alignClass(align?: 'left' | 'right' | 'center'): string {
  return align === 'right' ? 'is-right' : align === 'center' ? 'is-center' : '';
}

function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function ChecklistView({
  regionId,
  props,
}: {
  regionId: string;
  props: ChecklistProps;
}): JSX.Element {
  const host = useHost();
  return (
    <Panel title={props.title ?? 'Checklist'} kind="checklist">
      {props.items.length === 0 ? (
        <Empty>Nothing to check yet.</Empty>
      ) : (
        <ul className="sairi-list">
          {props.items.map((item) => (
            <li key={item.id}>
              <label className="sairi-check">
                <input
                  className="sairi-check__box"
                  defaultChecked={item.checked}
                  onChange={(event) =>
                    host.onChecklistToggle?.(regionId, item.id, event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  {item.label}
                  {item.note && <span className="sairi-check__note">{item.note}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TimelineView({ props }: { props: TimelineProps }): JSX.Element {
  return (
    <Panel title={props.title ?? 'Timeline'} kind="timeline">
      {props.entries.length === 0 ? (
        <Empty>No entries.</Empty>
      ) : (
        <ol className="sairi-timeline">
          {props.entries.map((entry, i) => (
            <li key={`${entry.at}-${i}`}>
              <div className="sairi-timeline__at">{entry.at}</div>
              <div>{entry.label}</div>
              {entry.detail && <div className="sairi-source__detail">{entry.detail}</div>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ProgressView({ props }: { props: ProgressProps }): JSX.Element {
  const clamped = Math.min(1, Math.max(0, props.value));
  const percent = Math.round(clamped * 100);
  return (
    <Panel title={props.title} kind="progress">
      <div className="sairi-progress__label">
        <span>{props.label ?? 'Progress'}</span>
        <span>{props.indeterminate ? 'working' : `${percent}%`}</span>
      </div>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        {...(props.indeterminate ? {} : { 'aria-valuenow': percent })}
        className="sairi-progress__track"
        role="progressbar"
      >
        <div
          className={`sairi-progress__fill${props.indeterminate ? ' sairi-progress__fill--indeterminate' : ''}`}
          style={props.indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
    </Panel>
  );
}

function StatusPanelView({ props }: { props: StatusPanelProps }): JSX.Element {
  return (
    <Panel title={props.title ?? 'Status'} kind="status-panel">
      {props.items.length === 0 ? (
        <Empty>No status reported.</Empty>
      ) : (
        <ul className="sairi-list">
          {props.items.map((item, i) => (
            <li key={`${item.label}-${i}`}>
              <div className="sairi-status">
                <span className={`sairi-status__dot sairi-status__dot--${item.state}`} />
                <span>
                  {item.label}
                  {item.detail && <span className="sairi-status__detail"> — {item.detail}</span>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TerminalOutputView({ props }: { props: TerminalOutputProps }): JSX.Element {
  return (
    <Panel title={props.title ?? 'Output'} kind="terminal-output">
      <pre className="sairi-terminal">
        {props.lines.join('\n')}
        {props.exitCode !== undefined && (
          <span className="sairi-terminal__exit">exit {props.exitCode}</span>
        )}
      </pre>
    </Panel>
  );
}

function FileListView({ props }: { props: FileListProps }): JSX.Element {
  return (
    <Panel title={props.title ?? 'Files'} kind="file-list">
      {props.files.length === 0 ? (
        <Empty>No files in this context yet.</Empty>
      ) : (
        <ul className="sairi-list">
          {props.files.map((file, i) => (
            <li className="sairi-list__row" key={`${file.relativePath}-${i}`}>
              <div className="sairi-source">
                <span className="sairi-source__label">
                  {file.name}
                  {file.untrusted === true && <span className="sairi-untrusted">untrusted</span>}
                </span>
                <span className="sairi-source__detail">
                  {file.relativePath}
                  {file.byteSize !== undefined && ` · ${formatBytes(file.byteSize)}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionButtonView({ props }: { props: ActionButtonProps }): JSX.Element {
  const host = useHost();
  const variant = props.variant ?? 'default';
  return (
    <Panel kind="action-button">
      <button
        className={`sairi-button${variant === 'default' ? '' : ` sairi-button--${variant}`}`}
        disabled={host.busy === true}
        onClick={() => host.onAction?.(props.actionId, props.capability)}
        type="button"
      >
        {props.label}
      </button>
      {props.description && <p className="sairi-button__description">{props.description}</p>}
      {props.capability && (
        <p className="sairi-button__description">
          Requires <code>{props.capability}</code>. You will be asked before it runs.
        </p>
      )}
    </Panel>
  );
}

// --- broker-backed component ----------------------------------------------

function PermissionRequestView({ props }: { props: PermissionRequestProps }): JSX.Element {
  const host = useHost();
  // The model supplies a requestId; the BROKER decides whether it is real. A
  // request the broker does not know about is never approvable.
  const known = host.permissions[props.requestId];

  if (!known) {
    return (
      <Panel title="Permission request" kind="permission-request">
        <div className="sairi-render-error">
          <p className="sairi-render-error__title">Unverified permission request</p>
          <p className="sairi-text sairi-text--muted">
            The interface asked to approve <code>{props.capability}</code>, but the permission
            broker has no matching request. Nothing can be approved from here.
          </p>
        </div>
      </Panel>
    );
  }

  const decided = known.status !== 'pending';

  return (
    <Panel title={props.title ?? 'Permission request'} kind="permission-request">
      <div className={`sairi-permission sairi-permission--${known.risk}`}>
        <div>
          <span className="sairi-permission__capability">{known.capability}</span>
          <span className="sairi-permission__risk">{known.risk} risk</span>
        </div>
        <p className="sairi-permission__reason">{known.reason}</p>
        {decided ? (
          <p className="sairi-text sairi-text--muted">Decided: {known.status}</p>
        ) : (
          <div className="sairi-permission__actions">
            <button
              className="sairi-button sairi-button--primary"
              onClick={() =>
                host.onPermissionDecision?.(props.requestId, 'allow', {
                  scope: 'once',
                  remember: false,
                })
              }
              type="button"
            >
              Allow once
            </button>
            <button
              className="sairi-button"
              onClick={() =>
                host.onPermissionDecision?.(props.requestId, 'allow', {
                  scope: 'context',
                  remember: true,
                })
              }
              type="button"
            >
              Allow for this context
            </button>
            <button
              className="sairi-button"
              onClick={() =>
                host.onPermissionDecision?.(props.requestId, 'deny', {
                  scope: 'once',
                  remember: false,
                })
              }
              type="button"
            >
              Deny
            </button>
            <button
              className="sairi-button sairi-button--danger"
              onClick={() =>
                host.onPermissionDecision?.(props.requestId, 'deny', {
                  scope: 'context',
                  remember: true,
                })
              }
              type="button"
            >
              Deny and remember
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

// --- host-content components ----------------------------------------------

function ContextMetadataView({ props }: { props: ContextMetadataProps }): JSX.Element {
  const { context } = useHost();
  if (!context) {
    return (
      <Panel title={props.title ?? 'Context'} kind="context-metadata">
        <Empty>No context loaded.</Empty>
      </Panel>
    );
  }
  return (
    <Panel title={props.title ?? 'Context'} kind="context-metadata">
      <ul className="sairi-list">
        <li className="sairi-list__row">
          <span className="sairi-list__label">Name</span>
          <span className="sairi-list__value">{context.name}</span>
        </li>
        <li className="sairi-list__row">
          <span className="sairi-list__label">Type</span>
          <span className="sairi-list__value">
            <span className={`sairi-badge sairi-badge--${context.type}`}>{context.type}</span>
          </span>
        </li>
        <li className="sairi-list__row">
          <span className="sairi-list__label">Status</span>
          <span className="sairi-list__value">{context.status}</span>
        </li>
        <li className="sairi-list__row">
          <span className="sairi-list__label">Updated</span>
          <span className="sairi-list__value">{new Date(context.updatedAt).toLocaleString()}</span>
        </li>
        {props.showObjective !== false && (
          <li className="sairi-list__row">
            <span className="sairi-list__label">Objective</span>
            <span className="sairi-list__value">{context.objective || '—'}</span>
          </li>
        )}
      </ul>
    </Panel>
  );
}

function ActivityLogView({ props }: { props: ActivityLogProps }): JSX.Element {
  const { context } = useHost();
  const limit = props.limit ?? 20;
  const events = context ? [...context.events].slice(-limit).reverse() : [];
  return (
    <Panel title={props.title ?? 'Activity'} kind="activity-log">
      {events.length === 0 ? (
        <Empty>Nothing has happened in this context yet.</Empty>
      ) : (
        <ol className="sairi-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <div className="sairi-timeline__at">
                {new Date(event.at).toLocaleTimeString()} · {event.kind}
              </div>
              <div>{event.summary}</div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/**
 * The one place a component type string becomes a component.
 *
 * The switch is exhaustive over the catalog: TypeScript fails the build if a
 * type is added to the schema without a renderer, which is what keeps the
 * schema and the renderer from drifting apart.
 */
export function renderComponent(regionId: string, spec: ComponentSpec): JSX.Element {
  switch (spec.type) {
    case 'text':
      return <TextView props={spec.props} />;
    case 'markdown':
      return <MarkdownView props={spec.props} />;
    case 'source-list':
      return <SourceListView props={spec.props} />;
    case 'key-value-list':
      return <KeyValueListView props={spec.props} />;
    case 'editor':
      return <EditorView props={spec.props} regionId={regionId} />;
    case 'table':
      return <TableView props={spec.props} />;
    case 'checklist':
      return <ChecklistView props={spec.props} regionId={regionId} />;
    case 'timeline':
      return <TimelineView props={spec.props} />;
    case 'progress':
      return <ProgressView props={spec.props} />;
    case 'status-panel':
      return <StatusPanelView props={spec.props} />;
    case 'permission-request':
      return <PermissionRequestView props={spec.props} />;
    case 'action-button':
      return <ActionButtonView props={spec.props} />;
    case 'terminal-output':
      return <TerminalOutputView props={spec.props} />;
    case 'file-list':
      return <FileListView props={spec.props} />;
    case 'context-metadata':
      return <ContextMetadataView props={spec.props} />;
    case 'activity-log':
      return <ActivityLogView props={spec.props} />;
    default: {
      const exhaustive: never = spec;
      void exhaustive;
      return (
        <div className="sairi-render-error">
          <p className="sairi-render-error__title">Unrenderable component</p>
        </div>
      );
    }
  }
}
