import type { JSX } from 'react';
import type { Context } from '@sairios/context-schema';
import { SairiUIRenderer, type SairiUIHost } from '@sairios/ui-components';
import type { PermissionRequestRecord } from '../api.js';
import { relativeTime } from './ContextMap.js';

/**
 * A context window.
 *
 * Every window is a context, so the title bar identifies the context rather
 * than a document: name, type, lifecycle status, and what the agent is doing
 * right now. The body is the adaptive layout; the aside is the part of the
 * window SairiOS always controls — permissions and activity.
 */

export interface ContextWindowProps {
  context: Context;
  host: SairiUIHost;
  requests: PermissionRequestRecord[];
  activity: string | null;
  busy: boolean;
  onClose: () => void;
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

export function ContextWindow(props: ContextWindowProps): JSX.Element {
  const { context } = props;
  const pending = props.requests.filter((r) => r.status === 'pending');
  const settled = props.requests.filter((r) => r.status !== 'pending');

  return (
    <section className="window">
      <header className="window__titlebar">
        <button className="window__close" onClick={props.onClose} type="button">
          Contexts
        </button>
        <h1 className="window__title">{context.name}</h1>
        <span className={`sairi-badge sairi-badge--${context.type}`}>{context.type}</span>
        <div className="window__spacer" />
        <span className="window__state">
          <span
            className="menubar__status-dot"
            style={{ background: statusColour(context.status) }}
          />
          {context.status}
        </span>
        <span className="window__state">
          {props.activity ?? `agent ${context.agentSession.status}`}
        </span>
      </header>

      <div className="window__body">
        <div>
          {context.uiSpecification ? (
            <SairiUIRenderer document={context.uiSpecification} host={props.host} />
          ) : (
            <div className="sairi-panel">
              <div className="sairi-panel__body">
                <p className="sairi-text sairi-text--muted">
                  No interface yet. Submit an intention and the agent will produce one.
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="window__aside">
          <div className="aside-panel">
            <h2 className="aside-panel__title">Permissions</h2>
            {pending.length === 0 && settled.length === 0 && (
              <p className="aside-panel__muted">Nothing has been requested in this context.</p>
            )}
            {pending.map((request) => (
              <div className="aside-panel__row" key={request.id}>
                <div>
                  <code>{request.capability}</code>{' '}
                  <span className="sairi-permission__risk">{request.risk}</span>
                </div>
                <p className="aside-panel__muted">{request.reason}</p>
                <div className="aside-panel__actions">
                  <button
                    className="sairi-button sairi-button--primary"
                    onClick={() =>
                      props.onDecision(request.id, 'allow', { scope: 'once', remember: false })
                    }
                    type="button"
                  >
                    Allow once
                  </button>
                  <button
                    className="sairi-button"
                    onClick={() =>
                      props.onDecision(request.id, 'allow', { scope: 'context', remember: true })
                    }
                    type="button"
                  >
                    Allow here
                  </button>
                  <button
                    className="sairi-button"
                    onClick={() =>
                      props.onDecision(request.id, 'deny', { scope: 'once', remember: false })
                    }
                    type="button"
                  >
                    Deny
                  </button>
                  <button
                    className="sairi-button sairi-button--danger"
                    onClick={() =>
                      props.onDecision(request.id, 'deny', { scope: 'context', remember: true })
                    }
                    type="button"
                  >
                    Deny + remember
                  </button>
                  <button
                    className="sairi-button"
                    onClick={() => props.onCancelRequest(request.id)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
            {settled.map((request) => (
              <div className="aside-panel__row" key={request.id}>
                <div>
                  <code>{request.capability}</code> — {request.status}
                </div>
                {request.outcome && (
                  <p className="aside-panel__muted">
                    {request.outcome.summary}
                    {request.outcome.simulated && ' (simulated)'}
                  </p>
                )}
                {request.error && <p className="aside-panel__muted">{request.error.message}</p>}
              </div>
            ))}
          </div>

          <div className="aside-panel">
            <h2 className="aside-panel__title">Context</h2>
            <div className="aside-panel__row">
              <span className="aside-panel__muted">Updated {relativeTime(context.updatedAt)}</span>
            </div>
            <div className="aside-panel__actions">
              {context.type === 'crystallized' ? (
                <button
                  className="sairi-button sairi-button--primary"
                  onClick={props.onInstantiate}
                  type="button"
                >
                  Run this workflow
                </button>
              ) : (
                <>
                  <button className="sairi-button" onClick={props.onCrystallize} type="button">
                    Crystallize context
                  </button>
                  <button
                    className="sairi-button"
                    disabled={context.status === 'completed' || context.status === 'archived'}
                    onClick={props.onComplete}
                    type="button"
                  >
                    Mark complete
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="aside-panel">
            <h2 className="aside-panel__title">Agent activity</h2>
            <ol className="log">
              {[...context.events]
                .slice(-25)
                .reverse()
                .map((event) => (
                  <li key={event.id}>
                    <span className="log__at">{new Date(event.at).toLocaleTimeString()} </span>
                    {event.summary}
                  </li>
                ))}
            </ol>
          </div>
        </aside>
      </div>
    </section>
  );
}

function statusColour(status: Context['status']): string {
  switch (status) {
    case 'active':
      return 'var(--sairi-ok)';
    case 'waiting':
      return 'var(--sairi-warn)';
    case 'failed':
      return 'var(--sairi-error)';
    case 'completed':
      return 'var(--sairi-accent)';
    default:
      return 'var(--sairi-border-strong)';
  }
}
