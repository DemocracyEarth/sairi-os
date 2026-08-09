import type { JSX } from 'react';
import { StatusOrb } from './primitives.js';
import type { DictationControls } from './useDictation.js';

/**
 * The visible half of hold-to-talk.
 *
 * Everything here is host chrome — drawn by the shell, driven by broker and
 * recogniser state, and never by anything a model can influence. A listening
 * indicator an agent could paint would be worthless, because the one thing it
 * has to be trusted about is whether a microphone is open.
 *
 * All feedback is visual, and that is a rule rather than an omission. The
 * moment SairiOS answers a spoken input with a spoken acknowledgement, the user
 * has been invited into a conversation and the interface has started becoming a
 * transcript. Speech in, screen out.
 */

export function Talk({ talk }: { talk: DictationControls }): JSX.Element | null {
  const { availability, phase } = talk;
  if (!availability) return null;

  // Offer the download, but never start it: sixty megabytes fetched to enable
  // something nobody asked for yet is not a decision the OS gets to make.
  if (availability.state === 'downloadable') {
    return (
      <p className="s-talk s-talk--note">
        <span>Voice needs a one-time on-device model, about 60 MB.</span>
        <button className="s-mini" disabled={talk.installing} onClick={talk.install} type="button">
          {talk.installing ? 'Downloading…' : 'Download it'}
        </button>
      </p>
    );
  }

  if (availability.state === 'downloading') {
    return <p className="s-talk s-talk--note">Downloading the on-device voice model…</p>;
  }

  /* Refusing out loud rather than hiding the feature. "Voice is missing and I
     cannot tell why" is a worse experience than a sentence explaining that this
     browser can only transcribe by uploading, and that SairiOS will not. */
  if (availability.state === 'unsupported' || availability.state === 'no-local-guarantee') {
    return (
      <p className="s-talk s-talk--note" title={availability.reason}>
        <span className="s-talk__off">Voice unavailable</span> — {availability.reason}
      </p>
    );
  }

  if (phase === 'awaiting-consent') {
    return (
      <div className="s-talk s-talk--consent" role="group" aria-label="Microphone permission">
        <p className="s-talk__ask">
          <strong>Use the microphone?</strong> Speech is transcribed on this machine. SairiOS
          receives no audio and no transcript.
        </p>
        <div className="s-talk__answers">
          <button
            className="s-btn s-btn--primary"
            onClick={() => talk.grant('context')}
            type="button"
          >
            Allow for this context
          </button>
          <button className="s-btn" onClick={() => talk.grant('once')} type="button">
            Just once
          </button>
          <button className="s-btn" onClick={talk.refuse} type="button">
            Not now
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'refused' && talk.message) {
    return <p className="s-talk s-talk--note s-talk--warn">{talk.message}</p>;
  }

  if (phase === 'authorising') {
    return (
      <p className="s-talk s-talk--note">
        <StatusOrb pulse size={6} /> Asking permission…
      </p>
    );
  }

  if (phase === 'listening') {
    return (
      <div aria-live="polite" className="s-talk s-talk--live">
        <span className="s-talk__pip" aria-hidden="true" />
        <span className="s-talk__label">Listening</span>
        {/* The interim transcript, shown so the user can see it going wrong
            while there is still time to release and fix it. */}
        <span className="s-talk__partial">{talk.partial || 'say what you want to accomplish'}</span>
        <span className="s-talk__hint">release to keep · esc to discard</span>
      </div>
    );
  }

  if (talk.message) return <p className="s-talk s-talk--note">{talk.message}</p>;
  return null;
}

/**
 * A press-and-hold microphone button.
 *
 * Pointer users need the same gesture keyboard users get, and it has to be the
 * SAME gesture: a click-to-toggle microphone is a microphone that can be left
 * on. Held, or off.
 */
export function TalkButton({ talk }: { talk: DictationControls }): JSX.Element | null {
  const ready = talk.availability?.state === 'ready';
  if (!ready) return null;

  const live = talk.phase === 'listening' || talk.phase === 'authorising';

  return (
    <button
      aria-label="Hold to dictate"
      aria-pressed={live}
      className={`s-talkbtn${live ? ' is-live' : ''}`}
      onPointerCancel={talk.cancel}
      onPointerDown={(e) => {
        // Capture, so a pointer that drifts off the button still delivers its
        // release here. Losing pointerup means a microphone nobody closed.
        e.currentTarget.setPointerCapture(e.pointerId);
        talk.begin();
      }}
      onPointerUp={talk.end}
      title="Hold to dictate (or hold ⌘K)"
      type="button"
    >
      <span aria-hidden="true" className="s-talkbtn__mic" />
    </button>
  );
}
