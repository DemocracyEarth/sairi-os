/**
 * Push-to-talk dictation, on-device only.
 *
 * ---------------------------------------------------------------------------
 * Voice is an input transport, not a conversational channel
 * ---------------------------------------------------------------------------
 * Speech becomes text becomes an intention, and the system answers on the
 * screen. Nothing here speaks, and nothing here should ever grow the ability
 * to. A machine that replies in sentences invites a reply, and two turns later
 * you have rebuilt the message list that CLAUDE.md forbids — except worse,
 * because a spoken exchange cannot be scrolled, diffed or audited, which breaks
 * the rule that a user must always know whether something really happened.
 *
 * ---------------------------------------------------------------------------
 * Why the browser's own recogniser, and why it is gated so carefully
 * ---------------------------------------------------------------------------
 * `SpeechRecognition` has shipped for years, and for most of that time Chrome
 * implemented it by streaming your microphone to Google. An OS that promises
 * local-only processing cannot use that, and — worse — cannot use an API that
 * SOMETIMES does that, because the page cannot observe which branch ran.
 *
 * Chrome 139 added `processLocally`, with `available()` reporting whether a
 * language pack is actually on the machine. That makes the guarantee checkable
 * rather than hoped for, so this module:
 *
 *   - asks `available({ processLocally: true })` before offering dictation;
 *   - sets `processLocally = true` on every recogniser it creates;
 *   - and NEVER falls back to the cloud path when the local one is missing.
 *
 * That last one is the whole point. A fallback would mean a user who was told
 * "on-device" gets their voice uploaded on some machines and not others, with
 * no way to tell which — the exact shape of the fabricated-result failure the
 * project's honesty rules exist to prevent. When local is unavailable, this
 * module says so and dictation stays off.
 *
 * There is deliberately no mock provider here either. Mock mode must run with
 * no credentials, no network and no external process, and it does: it simply
 * has no dictation. Inventing a fake transcript to make the button light up
 * would be fabricating a result.
 */

/* -------------------------------------------------------------------------- *
 * The slice of the API this module uses.
 *
 * Declared locally because TypeScript's DOM library does not describe
 * SpeechRecognition at all, and describes none of the on-device additions.
 * Everything is optional: this must compile and run in browsers that have none
 * of it.
 * -------------------------------------------------------------------------- */

type AvailabilityWord = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  error: string;
  message?: string;
}

interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface RecognitionConstructor {
  new (): RecognitionInstance;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<AvailabilityWord>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  prototype: RecognitionInstance;
}

function constructor(): RecognitionConstructor | undefined {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/* -------------------------------------------------------------------------- *
 * Availability
 * -------------------------------------------------------------------------- */

export type SpeechAvailability =
  /** No recogniser at all. cog/WPE in the VM is here — the API is compiled out. */
  | { state: 'unsupported'; reason: string }
  /** A recogniser, but no way to prove it stays on the machine. Refused. */
  | { state: 'no-local-guarantee'; reason: string }
  /** On-device recognition exists but this language is not installed. */
  | { state: 'downloadable'; lang: string }
  | { state: 'downloading'; lang: string }
  | { state: 'ready'; lang: string };

export async function probeSpeech(lang = 'en-US'): Promise<SpeechAvailability> {
  const Recognition = constructor();
  if (!Recognition) {
    return {
      state: 'unsupported',
      reason: 'This browser has no speech recogniser.',
    };
  }

  // No `available()` means no way to ask whether recognition is local — which
  // in every shipping implementation means it is not. Refuse rather than
  // guess: the cost of guessing wrong is the user's voice leaving the machine.
  if (typeof Recognition.available !== 'function' || !('processLocally' in Recognition.prototype)) {
    return {
      state: 'no-local-guarantee',
      reason:
        'This browser can only transcribe by sending audio to a remote service. SairiOS will not do that.',
    };
  }

  let word: AvailabilityWord;
  try {
    word = await Recognition.available({ langs: [lang], processLocally: true });
  } catch {
    return { state: 'no-local-guarantee', reason: 'The browser refused to report availability.' };
  }

  switch (word) {
    case 'available':
      return { state: 'ready', lang };
    case 'downloadable':
      return { state: 'downloadable', lang };
    case 'downloading':
      return { state: 'downloading', lang };
    default:
      return {
        state: 'no-local-guarantee',
        reason: `No on-device model for ${lang} is available on this machine.`,
      };
  }
}

/**
 * Fetches the on-device language pack.
 *
 * Only ever called from an explicit user action. It is a download of roughly
 * sixty megabytes, and a download that starts on its own — to enable a feature
 * the user has not asked for yet — is not a reasonable thing for an operating
 * system to do behind someone's back.
 */
export async function installSpeechModel(lang = 'en-US'): Promise<boolean> {
  const Recognition = constructor();
  if (typeof Recognition?.install !== 'function') return false;
  try {
    return await Recognition.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- *
 * Dictation
 * -------------------------------------------------------------------------- */

export interface DictationHandlers {
  /** Called repeatedly with the best-so-far text. Display only, never stored. */
  onPartial?: (text: string) => void;
  /** The settled text, once. Lands in the intent field for the user to edit. */
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

export interface Dictation {
  start(): void;
  /** Ends the utterance and delivers whatever was heard. */
  stop(): void;
  /** Ends the utterance and throws it away. */
  cancel(): void;
}

export function createDictation(lang: string, handlers: DictationHandlers): Dictation | undefined {
  const Recognition = constructor();
  if (!Recognition) return undefined;

  const recognition = new Recognition();
  recognition.lang = lang;
  // Belt and braces: `probeSpeech` already refused any browser without this,
  // but the flag is what actually keeps the audio on the machine, so it is set
  // on the instance too rather than trusted from the check.
  recognition.processLocally = true;
  recognition.interimResults = true;
  // The user decides when the utterance ends by releasing the key. Without
  // this, the recogniser stops at the first pause and a thinking-out-loud
  // intention gets truncated mid-sentence.
  recognition.continuous = true;

  let heard = '';
  let discarded = false;

  recognition.onresult = (event) => {
    let settled = '';
    let pending = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result?.isFinal) settled += text;
      else pending += text;
    }
    heard = settled;
    handlers.onPartial?.((settled + pending).trim());
  };

  recognition.onerror = (event) => {
    // `no-speech` and `aborted` are how a held key with nothing said, or a
    // cancel, arrive. Neither is a fault worth showing someone.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    handlers.onError?.(
      event.error === 'not-allowed'
        ? 'The browser blocked microphone access.'
        : (event.message ?? `Dictation failed: ${event.error}`),
    );
  };

  recognition.onend = () => {
    if (!discarded) {
      const text = heard.trim();
      if (text) handlers.onFinal?.(text);
    }
    handlers.onEnd?.();
  };

  return {
    start() {
      discarded = false;
      heard = '';
      try {
        recognition.start();
      } catch {
        // Already running; a second keydown from key repeat. Not an error.
      }
    },
    stop() {
      recognition.stop();
    },
    cancel() {
      discarded = true;
      recognition.abort();
    },
  };
}
