import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDictation,
  installSpeechModel,
  probeSpeech,
  type Dictation,
  type SpeechAvailability,
} from './speech.js';
import { brokerApi } from '../api.js';

/**
 * Hold-to-talk, wired through the permission broker.
 *
 * ---------------------------------------------------------------------------
 * Why the broker is in the path at all
 * ---------------------------------------------------------------------------
 * The page could open a microphone by itself; the browser would ask, and that
 * would be that. It goes through the broker anyway because "every privileged
 * action goes through the broker" is not a routing convention, it is the thing
 * that makes a permission inspectable, scopeable and revocable. A microphone
 * that only the browser knows about has none of those.
 *
 * Every utterance is a full propose → decide → execute cycle. That sounds
 * heavy and is not: after one "allow for this context" the propose comes back
 * already `allowed`, so the cost is two loopback round trips. What it buys is
 * that policy is re-checked per utterance — a "deny and remember" stops the
 * next one — and that each utterance leaves its own audit entry.
 *
 * ---------------------------------------------------------------------------
 * What the broker is NOT told
 * ---------------------------------------------------------------------------
 * The audio, and the words. Capture and transcription both happen in this page
 * and the transcript goes straight into the intent field. The broker records
 * that a microphone was authorised, and genuinely cannot record what was said,
 * because it never receives it. `audio-capture.test.ts` holds that shut from
 * the other side.
 */

export type DictationPhase =
  | 'idle'
  /** Asking the broker. Brief on loopback, visible over a tunnel. */
  | 'authorising'
  /** Waiting for the user to decide. The utterance is not captured. */
  | 'awaiting-consent'
  | 'listening'
  | 'refused';

export interface DictationState {
  availability: SpeechAvailability | undefined;
  phase: DictationPhase;
  /** Best-so-far text while listening. Display only. */
  partial: string;
  message: string | undefined;
  /** True while the on-device model is downloading. */
  installing: boolean;
}

export interface DictationControls extends DictationState {
  /** Begin an utterance. Safe to call repeatedly; key repeat is ignored. */
  begin: () => void;
  /** End it and deliver the text. */
  end: () => void;
  /** End it and throw the text away. */
  cancel: () => void;
  /** Consent answers, for the inline prompt. */
  grant: (scope: 'once' | 'context') => void;
  refuse: () => void;
  /** Fetch the on-device language pack. User-initiated only. */
  install: () => void;
}

export function useDictation({
  contextId,
  lang = 'en-US',
  onTranscript,
}: {
  /** A broker-shaped context id; see `brokerContextId`. */
  contextId: string;
  lang?: string;
  /** Receives the settled text. The caller decides what to do with it. */
  onTranscript: (text: string) => void;
}): DictationControls {
  const [availability, setAvailability] = useState<SpeechAvailability | undefined>();
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [partial, setPartial] = useState('');
  const [message, setMessage] = useState<string | undefined>();
  const [installing, setInstalling] = useState(false);

  const dictation = useRef<Dictation | undefined>(undefined);
  const pendingRequest = useRef<string | undefined>(undefined);
  // Guards key repeat: holding a key fires keydown over and over, and each one
  // would otherwise start a fresh propose/execute pair.
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void probeSpeech(lang).then((result) => {
      if (alive.current) setAvailability(result);
    });
    return () => {
      alive.current = false;
      dictation.current?.cancel();
    };
  }, [lang]);

  const startCapture = useCallback(() => {
    const handle = createDictation(lang, {
      onPartial: setPartial,
      onFinal: (text) => onTranscript(text),
      onError: (text) => {
        setMessage(text);
        setPhase('refused');
      },
      onEnd: () => {
        setPartial('');
        busy.current = false;
        setPhase((p) => (p === 'listening' ? 'idle' : p));
      },
    });
    if (!handle) {
      setMessage('This browser has no on-device recogniser.');
      setPhase('refused');
      busy.current = false;
      return;
    }
    dictation.current = handle;
    handle.start();
    setPhase('listening');
  }, [lang, onTranscript]);

  const begin = useCallback(() => {
    if (busy.current) return;
    if (availability?.state !== 'ready') return;
    busy.current = true;
    setMessage(undefined);
    setPhase('authorising');

    void (async () => {
      const proposed = await brokerApi.propose({
        contextId,
        capability: 'audio.capture',
        // Read aloud in the prompt, so it has to say what it is for.
        reason: 'Dictate an intention with the microphone while you hold the talk key.',
        payload: { purpose: 'dictate an intention' },
      });

      if (!alive.current) return;
      if (!proposed.ok) {
        setMessage(proposed.message);
        setPhase('refused');
        busy.current = false;
        return;
      }

      const request = proposed.value;
      if (request.status === 'denied') {
        setMessage('The microphone is denied for this context.');
        setPhase('refused');
        busy.current = false;
        return;
      }
      if (request.status !== 'allowed') {
        // Policy says ask. The utterance is NOT captured — the user answers
        // first and holds again. Capturing while a consent prompt is on screen
        // would make the prompt decorative.
        pendingRequest.current = request.id;
        setPhase('awaiting-consent');
        busy.current = false;
        return;
      }

      const executed = await brokerApi.execute(request.id);
      if (!alive.current) return;
      if (!executed.ok || executed.value.status !== 'executed') {
        setMessage(executed.ok ? 'The broker refused the capture.' : executed.message);
        setPhase('refused');
        busy.current = false;
        return;
      }
      startCapture();
    })();
  }, [availability, contextId, startCapture]);

  const end = useCallback(() => {
    if (phase === 'listening') dictation.current?.stop();
    else if (phase === 'authorising') {
      // Released before the broker answered. Do not capture afterwards — a
      // microphone that opens after the key is up is the exact thing
      // push-to-talk exists to make impossible.
      busy.current = false;
      setPhase('idle');
    }
  }, [phase]);

  const cancel = useCallback(() => {
    dictation.current?.cancel();
    busy.current = false;
    setPartial('');
    setPhase('idle');
  }, []);

  const grant = useCallback((scope: 'once' | 'context') => {
    const id = pendingRequest.current;
    if (!id) return;
    void brokerApi.decide(id, 'allow', { scope, remember: scope === 'context' }).then(() => {
      if (!alive.current) return;
      pendingRequest.current = undefined;
      // Deliberately does not start listening. The user pressed a button,
      // they did not start speaking; opening the microphone here would be
      // capturing audio nobody asked to send.
      setPhase('idle');
      setMessage('Microphone allowed. Hold ⌘K to talk.');
    });
  }, []);

  const refuse = useCallback(() => {
    const id = pendingRequest.current;
    if (id) void brokerApi.decide(id, 'deny', { scope: 'once', remember: false });
    pendingRequest.current = undefined;
    setPhase('idle');
  }, []);

  const install = useCallback(() => {
    setInstalling(true);
    void installSpeechModel(lang).then(async () => {
      const next = await probeSpeech(lang);
      if (!alive.current) return;
      setAvailability(next);
      setInstalling(false);
    });
  }, [lang]);

  return {
    availability,
    phase,
    partial,
    message,
    installing,
    begin,
    end,
    cancel,
    grant,
    refuse,
    install,
  };
}
