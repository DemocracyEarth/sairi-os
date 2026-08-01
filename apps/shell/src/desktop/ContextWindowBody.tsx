import type { JSX } from 'react';
import type { Context } from '@sairios/context-schema';
import { SairiUIRenderer, useT, type MessageKey, type SairiUIHost } from '@sairios/ui-components';
import type { PermissionRequestRecord } from '../api.js';
import { relativeTime } from './ContextMapWindow.js';

/**
 * The inside of a context window.
 *
 * Two columns. The left is the adaptive layout the agent produced, validated
 * before it got here. The right is the part SairiOS always owns and the agent
 * can never draw: what has been requested, what was decided, and what actually
 * happened. Those never move into the model's half of the window, because a
 * permission prompt an agent can render is a permission prompt an agent can forge.
 */

export interface ContextWindowBodyProps {
  context: Context;
  host: SairiUIHost;
  requests: PermissionRequestRecord[];
  onCrystallize: () => void;
  onInstantiate: () => void;
  onComplete: () => void;
  onDecision: (
    requestId: string,
    decision: 'allow' | 'deny',
    options: { scope: 'once' | 'context'; remember: boolean },
  ) => void;
  onCancelRequest: (requestId: string) => void;
}

export function ContextWindowBody(props: ContextWindowBodyProps): JSX.Element {
  const t = useT();
  const { context } = props;
  const pending = props.requests.filter((r) => r.status === 'pending');
  const settled = props.requests.filter((r) => r.status !== 'pending');

  return (
    <div className="contextwin">
      <div>
        {context.uiSpecification ? (
          <SairiUIRenderer
            document={context.uiSpecification}
            errorTitle={t('render.unverified')}
            host={props.host}
          />
        ) : (
          <div className="panel">
            <div className="panel__body">
              <p className="aside__muted">{t('render.noInterface')}</p>
            </div>
          </div>
        )}
      </div>

      <aside className="aside">
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">{t('panel.permissions')}</h3>
          </div>
          <div className="panel__body">
            {pending.length === 0 && settled.length === 0 && (
              <p className="aside__muted">{t('panel.noPermissions')}</p>
            )}

            {pending.map((request) => (
              <div className="aside__row" key={request.id}>
                <div>
                  <code>{request.capability}</code>{' '}
                  <span className="badge badge--ephemeral">
                    {t('perm.risk', { level: request.risk })}
                  </span>
                </div>
                <p className="aside__muted">{request.reason}</p>
                <div className="aside__actions">
                  <button
                    className="btn btn--primary"
                    onClick={() =>
                      props.onDecision(request.id, 'allow', { scope: 'once', remember: false })
                    }
                    type="button"
                  >
                    {t('perm.allowOnce')}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      props.onDecision(request.id, 'allow', { scope: 'context', remember: true })
                    }
                    type="button"
                  >
                    {t('perm.allowContext')}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      props.onDecision(request.id, 'deny', { scope: 'once', remember: false })
                    }
                    type="button"
                  >
                    {t('perm.deny')}
                  </button>
                  <button
                    className="btn btn--danger"
                    onClick={() =>
                      props.onDecision(request.id, 'deny', { scope: 'context', remember: true })
                    }
                    type="button"
                  >
                    {t('perm.denyRemember')}
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => props.onCancelRequest(request.id)}
                    type="button"
                  >
                    {t('perm.cancel')}
                  </button>
                </div>
              </div>
            ))}

            {settled.map((request) => (
              <div className="aside__row" key={request.id}>
                <div>
                  <code>{request.capability}</code> — {request.status}
                </div>
                {request.outcome && (
                  <p className="aside__muted">
                    {request.outcome.summary}
                    {request.outcome.simulated && ` (${t('perm.simulated')})`}
                  </p>
                )}
                {request.error && <p className="aside__muted">{request.error.message}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">{t('panel.context')}</h3>
          </div>
          <div className="panel__body">
            <p className="aside__muted">
              {t('map.updated', { time: relativeTime(context.updatedAt, t) })}
            </p>
            <div className="aside__actions">
              {context.type === 'crystallized' ? (
                <button className="btn btn--primary" onClick={props.onInstantiate} type="button">
                  {t('panel.runWorkflow')}
                </button>
              ) : (
                <>
                  <button className="btn" onClick={props.onCrystallize} type="button">
                    {t('menu.crystallize')}
                  </button>
                  <button
                    className="btn"
                    disabled={context.status === 'completed' || context.status === 'archived'}
                    onClick={props.onComplete}
                    type="button"
                  >
                    {t('menu.markComplete')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">{t('panel.activity')}</h3>
            <span className="panel__kind">{context.events.length}</span>
          </div>
          <div className="panel__body">
            <ol className="log">
              {[...context.events]
                .slice(-25)
                .reverse()
                .map((event) => (
                  <li key={event.id}>
                    <span className="log__at">
                      {new Date(event.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                    </span>
                    {event.summary}
                  </li>
                ))}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Title-bar descriptor for a context window: "contexto efímero — <name>". */
export function contextWindowTitle(context: Context, t: ReturnType<typeof useT>): string {
  const kind = (
    {
      ephemeral: 'window.ephemeralContext',
      persistent: 'window.persistentContext',
      crystallized: 'window.crystallizedContext',
    } as const
  )[context.type];
  return `${t(kind as MessageKey)} — ${context.name}`;
}

export function contextWindowNote(context: Context, t: ReturnType<typeof useT>): string {
  switch (context.type) {
    case 'ephemeral':
      return t('window.closesOnComplete');
    case 'persistent':
      return t('window.staysOpen');
    default:
      return t('window.reusable');
  }
}
