import type { JSX } from 'react';
import { validateSairiUI, type SairiUIDocument } from '@sairios/adaptive-ui-schema';
import { renderComponent } from './components.js';
import { HostContext, type SairiUIHost } from './host.js';

/**
 * The SairiUI renderer.
 *
 * Validate, then render. A document that fails validation produces the error
 * state below and NOTHING from the document is rendered — not even the regions
 * that would have passed. Partial rendering of a rejected document would let an
 * attacker get a foothold on screen by making one region valid.
 */

export interface SairiUIRendererProps {
  /** Untrusted input: a document straight off the wire is acceptable here. */
  document: unknown;
  host: SairiUIHost;
  /** Shown above the layout when the document was rejected. */
  errorTitle?: string;
}

export function SairiUIRenderer({
  document,
  host,
  errorTitle = 'This interface could not be verified',
}: SairiUIRendererProps): JSX.Element {
  const result = validateSairiUI(document);

  if (!result.ok) {
    return (
      <div className="sairi-render-error">
        <p className="sairi-render-error__title">{errorTitle}</p>
        <p className="sairi-text sairi-text--muted">
          SairiOS validates every interface an agent produces before rendering it. This one did not
          match the SairiUI protocol, so nothing from it was displayed.
        </p>
        <ul className="sairi-render-error__list">
          {result.error.messages.slice(0, 8).map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <HostContext.Provider value={host}>
      <SairiUILayout document={result.value} />
    </HostContext.Provider>
  );
}

function SairiUILayout({ document }: { document: SairiUIDocument }): JSX.Element {
  const stack = document.layout.type === 'stack';
  return (
    <div className={`sairi-layout${stack ? ' sairi-layout--stack' : ''}`}>
      {document.layout.regions.map((region) => (
        <div className={`sairi-region--${region.width ?? 'full'}`} key={region.id}>
          {renderComponent(region.id, region.component)}
        </div>
      ))}
    </div>
  );
}
