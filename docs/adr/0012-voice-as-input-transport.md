# 0012. Voice is an input transport, and the microphone belongs to the broker

- Status: Accepted
- Date: 2026-08-08
- Deciders: SairiOS founding engineering

## Context

"Voice first" names two products that look identical from outside the request and are
opposites in practice:

- **Voice as a transport for intent.** Speech becomes text becomes an intention; the system
  answers on the screen. The universal intent field is already exactly this shape.
- **Voice as a conversational loop.** The machine talks back, the user replies, turns
  accumulate.

The second is the chatbot [invariant 2](../../CLAUDE.md) forbids, with the message list
deleted — which makes it worse, not better. A chat transcript is scrollable, diffable and
auditable. A spoken exchange is a transcript nobody can read, and it defeats the honesty rule
that a user must always know whether something really happened: a spoken "done, I sent it"
leaves no artifact to check.

The empirical record supports the split rather than contradicting it. Voice assistants failed
as general computing interfaces because speech is a poor _output_ channel with no affordances,
and usage stayed pinned to timers and music. Voice as _input_ is a shipping success: dictation
measured roughly 3× faster than typing, voice-directed warehouse picking has run
non-conversationally for two decades. The failures talk back; the successes answer on a screen.

Two facts about this deployment shaped the rest:

- **The microphone is not on the machine the broker runs on.** Over an SSH tunnel the browser
  is on the user's laptop and SairiOS is in the guest. Worse, the guest could not capture audio
  even if asked to: QEMU's `coreaudio` backend on macOS is playback-only (`audio: Can not open
'adc' (no host audio driver)`, reproduced locally), and Debian 12 ships wpewebkit 2.38.6 with
  `ENABLE_MEDIA_STREAM` compiled out, so `getUserMedia` does not exist in cog.
- **The browser can now transcribe locally, and can prove it.** Chrome 139 added
  `SpeechRecognition.processLocally` with `available()` reporting whether a language pack is
  actually present. For years the same API worked by streaming audio to Google.

## Decision

**Voice is an input transport.** Hold ⌘K, speak, release; the transcript lands in the intent
field as **editable text and is never submitted**. SairiOS does not speak. There is no
text-to-speech, no wake word, no ambient listening, no multi-turn voice state, and no spoken
approval of permissions.

**The microphone goes through the permission broker** as `audio.capture`, default `ask` and
never `allow`. Every utterance is a full propose → decide → execute cycle, so policy is
re-checked per utterance and each one leaves an audit entry.

**Recognition must be provably local.** The shell asks `available({ processLocally: true })`,
sets `processLocally` on every recogniser, and **never falls back to the cloud path**. Where
locality cannot be established, dictation is refused and the reason is shown.

## Consequences

**Push-to-talk is the permission grant.** The key press is the user decision: every utterance
is discrete, timestamped and physically held open. This is not merely the safer option — it is
the only one _representable_ in a three-phase permission model. An always-listening microphone
has no proposal and no decision to record.

**The transcript is editable, never auto-submitted.** This does most of the work. It turns
voice's worst property — an unrepairable command — into an ordinary text edit, and it means
nothing downstream can tell an intention was spoken: `readIntention` sees exactly what the
keyboard produces, so voice cannot grow a pipeline of its own. The input modality is
deliberately not sent to the provider; a model told the user is speaking starts writing
conversational prose into `text` components and drags the whole system toward dialogue.

**The broker authorises without performing, and that is weaker.** It is the first capability
whose resource is not on this machine. Enforcement is real but indirect — the shell opens no
microphone without an allowed-and-executed request — and the broker cannot stop another page
on that machine from asking for the same microphone itself. Recorded on the descriptor and in
[SECURITY.md](../../SECURITY.md) rather than glossed.

**In exchange, the strongest privacy property in the system.** Capture and transcription both
happen in the page, so no audio and no transcript reach SairiOS. The broker records _that_ a
microphone was authorised and is structurally unable to record _what_ was said.
`audio-capture.test.ts` asserts speech sent to the broker anyway is neither read nor echoed.

**Voice does not work in the VM's own browser, today.** Both blockers are above, and both are
in the base image rather than the design: Debian 13 ships wpewebkit 2.48.3 with `MEDIA_STREAM`
on. Over the tunnel — the intended path — it works in the host browser against the guest's
broker.

**Refusing is a visible state.** A browser that can only transcribe by uploading is told so on
screen. Hiding the feature would be kinder to look at and would leave the user unable to
discover why voice is missing; silently uploading instead would be the fabricated-result
failure the project's honesty rules exist to prevent.

**No mock transcription.** Mock mode still runs with no credentials, no network and no
external process — it simply has no dictation. A fake transcript to make the button light up
would be inventing a result, which invariant 6 forbids more specifically than it forbids a
missing feature.

**Spoken approval of permissions is refused as an attack, not as a preference.** An agent
holding `browser.open` could play audio that says "approve"; so could a television in the
room. Permission decisions stay on pointer and keyboard.
