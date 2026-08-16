import type { JSX } from 'react';
import type { PermissionRequestRecord } from '../api.js';

/**
 * The approval a handover needs before it can be approved.
 *
 * `agent.relay` was denied by default, and not because the machinery was
 * unfinished. A hop cannot be taken back — once another agent holds the
 * artifact, no later decision recovers it — and every other approval surface in
 * this shell renders capability, risk and reason. For a relay that answers "may
 * an agent hand something over" and leaves out *what*, *to whom*, and *which
 * bytes*. Approving what you cannot see is theatre, and a default of `ask`
 * without this panel would have been asking the user to perform it.
 *
 * So this renders the envelope itself: the destination, the artifact, its size,
 * and its digest. The digest is shown because it is the reason the approval
 * means anything — the broker re-checks it at execution, so what crosses is
 * exactly what is described here, and an artifact swapped in between fails
 * rather than sliding through under an approval the user already gave.
 *
 * Deliberately NOT a SairiUI catalog component. Adding one is a security review
 * with five required parts, and this needs none of that power: it renders
 * SairiOS's own broker state, never model-supplied content, so it cannot be
 * forged by a document. The model has no way to put this on screen — and
 * `agent.relay` is excluded from the SairiUI capability enum for the same
 * reason, with the exclusion asserted in `tests/capability-enums.test.ts`.
 */

/** The envelope, as the broker recorded it. Untrusted until proven otherwise. */
interface Handover {
  from: string;
  to: string;
  path: string;
  sha256: string;
  bytes: number;
}

/**
 * Reads a handover out of a recorded payload.
 *
 * The payload reaches here from the broker, which got it from an agent, so it
 * is checked field by field rather than cast. A malformed one renders nothing
 * and the generic approval stands — never a panel with blanks where the digest
 * should be, which is the shape most likely to be approved without reading.
 */
export function readHandover(payload: unknown): Handover | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const r = payload as Record<string, unknown>;
  const strings = ['from', 'to', 'path', 'sha256'] as const;
  for (const key of strings) {
    if (typeof r[key] !== 'string' || (r[key] as string).length === 0) return undefined;
  }
  if (typeof r['bytes'] !== 'number' || !Number.isFinite(r['bytes'])) return undefined;
  return {
    from: r['from'] as string,
    to: r['to'] as string,
    path: r['path'] as string,
    sha256: r['sha256'] as string,
    bytes: r['bytes'] as number,
  };
}

/** Bytes, in units a person reads without counting zeroes. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function HandoverApproval({
  record,
  onDecide,
  busy,
}: {
  record: PermissionRequestRecord;
  onDecide: (decision: 'allow' | 'deny') => void;
  busy?: boolean;
}): JSX.Element | null {
  const handover = readHandover(record.payload);
  if (!handover) return null;

  return (
    <article className="s-hand">
      <header className="s-hand__top">
        <span className="s-hand__eyebrow">Handover</span>
        <span className="s-hand__route">
          {handover.from} <span aria-hidden="true">→</span> {handover.to}
        </span>
      </header>

      <p className="s-hand__reason">{record.reason}</p>

      <dl className="s-hand__facts">
        <div>
          <dt>Artifact</dt>
          <dd className="s-hand__path">{handover.path}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{size(handover.bytes)}</dd>
        </div>
        <div>
          <dt>Digest</dt>
          {/* Full, not truncated. A digest shortened for tidiness is a digest
              nobody can check, and checking it is the entire point. */}
          <dd className="s-hand__digest">{handover.sha256}</dd>
        </div>
      </dl>

      <p className="s-hand__note">
        Nothing is sent. {handover.to} must read this file under its own permission, which you will
        be asked about separately. Afterwards this context stops reusing remembered permissions.
      </p>

      <div className="s-hand__actions">
        <button
          className="s-btn s-btn--primary"
          disabled={busy}
          onClick={() => onDecide('allow')}
          type="button"
        >
          Hand it over
        </button>
        <button className="s-btn" disabled={busy} onClick={() => onDecide('deny')} type="button">
          Keep it here
        </button>
      </div>
    </article>
  );
}
