import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDictation, probeSpeech } from './speech.js';

/**
 * The promise this module makes is that speech never leaves the machine, and
 * the only way it can keep that promise is by refusing browsers that cannot
 * prove it. So these tests are mostly about what does NOT happen.
 *
 * The failure being guarded against is specific and quiet: Chrome shipped
 * `SpeechRecognition` for years by streaming microphone audio to Google. A
 * fallback to that path would upload a user's voice on some machines and not
 * others, with nothing on screen distinguishing the two.
 *
 * Note the stubs put `processLocally` on the PROTOTYPE. That is where a real
 * IDL attribute lives, and where the module looks — an early version of this
 * file declared it as a class field, which is per-instance, and the module
 * correctly reported the stub as a browser with no on-device support.
 */

const KEYS = ['SpeechRecognition', 'webkitSpeechRecognition'] as const;
const NATIVE = Object.fromEntries(KEYS.map((k) => [k, (globalThis as Record<string, unknown>)[k]]));

interface Stub extends Record<string, unknown> {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  starts: number;
  aborts: number;
}

/** Installs a recogniser and returns the instances the module constructs. */
function install(options: { onDevice: boolean; available?: string; throws?: boolean }): {
  made: Stub[];
  available: ReturnType<typeof vi.fn>;
} {
  const made: Stub[] = [];

  class Recognition {
    lang = '';
    continuous = false;
    interimResults = false;
    starts = 0;
    aborts = 0;
    onresult: unknown = null;
    onerror: unknown = null;
    onend: unknown = null;
    onstart: unknown = null;
    constructor() {
      made.push(this as unknown as Stub);
    }
    start(): void {
      this.starts += 1;
    }
    stop(): void {}
    abort(): void {
      this.aborts += 1;
    }
  }

  const available = vi.fn(async () => {
    if (options.throws) throw new Error('nope');
    return options.available ?? 'available';
  });

  if (options.onDevice) {
    // On the prototype, like the real IDL attribute.
    Object.defineProperty(Recognition.prototype, 'processLocally', {
      writable: true,
      configurable: true,
      value: false,
    });
    Object.assign(Recognition, { available, install: vi.fn(async () => true) });
  }

  (globalThis as Record<string, unknown>)['SpeechRecognition'] = Recognition;
  delete (globalThis as Record<string, unknown>)['webkitSpeechRecognition'];
  return { made, available };
}

afterEach(() => {
  for (const key of KEYS) (globalThis as Record<string, unknown>)[key] = NATIVE[key];
});

describe('probeSpeech', () => {
  it('reports unsupported when there is no recogniser', async () => {
    for (const key of KEYS) delete (globalThis as Record<string, unknown>)[key];
    expect((await probeSpeech()).state).toBe('unsupported');
  });

  it('refuses a recogniser that cannot promise on-device processing', async () => {
    // The important case. This browser WOULD transcribe — by uploading. The
    // module must decline rather than take the free feature.
    install({ onDevice: false });
    const result = await probeSpeech();
    expect(result.state).toBe('no-local-guarantee');
    if (result.state === 'no-local-guarantee') expect(result.reason).toContain('remote');
  });

  it('never asks a question whose answer it is not allowed to act on', async () => {
    const { available } = install({ onDevice: true, available: 'available' });
    await probeSpeech('en-US');
    expect(available).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    // Never probed with processLocally:false. "Is recognition available at all"
    // has no answer this module may use, so it is not asked.
    for (const [arg] of available.mock.calls) {
      expect((arg as unknown as { processLocally: boolean }).processLocally).toBe(true);
    }
  });

  it('maps each availability word to a distinct state', async () => {
    for (const [word, state] of [
      ['available', 'ready'],
      ['downloadable', 'downloadable'],
      ['downloading', 'downloading'],
      ['unavailable', 'no-local-guarantee'],
    ] as const) {
      install({ onDevice: true, available: word });
      expect((await probeSpeech()).state).toBe(state);
    }
  });

  it('refuses rather than assumes when the browser throws', async () => {
    install({ onDevice: true, throws: true });
    expect((await probeSpeech()).state).toBe('no-local-guarantee');
  });
});

describe('createDictation', () => {
  it('sets processLocally on the instance, not only at the probe', () => {
    const { made } = install({ onDevice: true });
    createDictation('en-US', {})?.start();
    // The probe answers a question about the browser; this flag is what
    // actually keeps the audio on the machine, so it is set either way.
    expect(made[0]?.processLocally).toBe(true);
  });

  it('keeps listening across pauses, so a held key is not cut off mid-sentence', () => {
    const { made } = install({ onDevice: true });
    createDictation('en-US', {})?.start();
    expect(made[0]?.continuous).toBe(true);
    expect(made[0]?.interimResults).toBe(true);
    expect(made[0]?.lang).toBe('en-US');
  });

  it('ignores a repeated start rather than throwing on key repeat', () => {
    const { made } = install({ onDevice: true });
    const dictation = createDictation('en-US', {});
    dictation?.start();
    dictation?.start();
    expect(made).toHaveLength(1);
  });

  it('delivers the settled transcript once, when the utterance ends', () => {
    const { made } = install({ onDevice: true });
    const onFinal = vi.fn();
    const onPartial = vi.fn();
    createDictation('en-US', { onFinal, onPartial })?.start();
    const instance = made[0]!;

    (instance['onresult'] as (e: unknown) => void)({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal: false, 0: { transcript: 'plan a' } } },
    });
    expect(onPartial).toHaveBeenCalledWith('plan a');
    expect(onFinal).not.toHaveBeenCalled();

    (instance['onresult'] as (e: unknown) => void)({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal: true, 0: { transcript: 'plan a trip' } } },
    });
    (instance['onend'] as () => void)();

    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('plan a trip');
  });

  it('discards the transcript on cancel', () => {
    // A microphone whose output arrives after you threw it away is worse than
    // one that never worked.
    const { made } = install({ onDevice: true });
    const onFinal = vi.fn();
    const dictation = createDictation('en-US', { onFinal });
    dictation?.start();
    const instance = made[0]!;

    (instance['onresult'] as (e: unknown) => void)({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal: true, 0: { transcript: 'my password is' } } },
    });
    dictation?.cancel();
    (instance['onend'] as () => void)();

    expect(onFinal).not.toHaveBeenCalled();
    expect(instance.aborts).toBe(1);
  });

  it('does not surface silence or cancellation as an error', () => {
    const { made } = install({ onDevice: true });
    const onError = vi.fn();
    createDictation('en-US', { onError })?.start();
    const emit = made[0]!['onerror'] as (e: { error: string }) => void;

    emit({ error: 'no-speech' });
    emit({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();

    emit({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain('blocked');
  });
});
