# 0003. Declarative adaptive UI, never generated code

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

The product thesis requires the interface to change with the task. A context for reviewing
a contract should not look like a context for triaging a build failure. The system decides,
per context and per moment, what the user should be looking at.

There is an obvious way to build that, and it is a trap. Ask the model for the interface
and get back React, HTML or JavaScript, then run it. It is fast to demo, it is flexible in
a way nothing else is, and it is the single worst security decision available to this
project.

The reason is precise. A SairiOS context ingests untrusted content by design: file
contents, web pages the agent fetched, tool output, command results, documents a user
dropped in. Any of that can contain text aimed at the model. If the model's response is
executed as frontend code in the user's shell, then every prompt injection is a remote code
execution in the user's session. Not a bad render. Not a confusing answer. Code, running
in the process that holds the user's session, with access to whatever the shell can reach.
There is no prompt engineering that closes this, because the failure is architectural: the
system is asking an untrusted-input-processing component to emit executable code and then
executing it.

So the requirement is to get adaptivity without ever putting model output on an execution
path.

There is a second, quieter requirement. SairiOS has a visual language (early Macintosh
clarity, UNIX workstation utility, modern typography, tight and consistent). Generated
markup does not respect a design system. It approximates one, differently each time, and
the environment stops feeling like one piece of software.

## Decision

The adaptive interface is a versioned declarative JSON protocol called **SairiUI**. The
model returns a JSON document describing what the interface should contain. It never
returns executable frontend code, and SairiOS never evaluates model output as code.

The protocol is defined by a JSON Schema (`packages/adaptive-ui-schema`, currently
`version: "0.1"`) and an audited catalog of exactly **16** component types:

```
text            markdown         source-list       key-value-list
editor          table            checklist         timeline
progress        status-panel     permission-request action-button
terminal-output file-list        context-metadata  activity-log
```

Each component type has a fixed, enumerated set of props. Every object in the schema is
`additionalProperties: false`.

### Validate then render

Rendering is a two-phase operation and the phases do not interleave.

1. The complete document is validated against the schema and the catalog.
2. Only if validation passes does anything render.

No component is instantiated during validation. Nothing is rendered speculatively while
the rest of the document is still being checked.

### Whole-document rejection

If any part of the document fails validation, the **entire document is rejected**. There
is no partial render, no dropping of the offending node, no best-effort repair.

This is deliberate and it is the rule most likely to be argued with, so the reasoning is
recorded here. Partial rendering means an attacker who cannot get a valid malicious
document through can still get a _partially_ rendered one, choosing which parts survive.
It also means the user sees an interface that nobody designed, missing pieces, with no
signal that anything is wrong. A permission-request component silently dropped from a
document is a security failure that looks like a rendering glitch. All-or-nothing is the
only rule that keeps "what the user sees" equal to "what was validated".

Specifically rejected as whole-document failures:

- an unknown component `type`,
- an unknown prop on a known component,
- a prop of the wrong type, or a string past its length bound,
- a reference to a region or component id that does not exist,
- a `version` the renderer does not implement.

### Safe error state

On rejection, the shell renders a fixed, hand-written error state built from the same
component set as everything else. It states that the interface could not be validated,
identifies the context, gives the user the ordinary controls (retry, view the raw payload,
open the activity log) and is entirely under SairiOS's control. It contains nothing from
the rejected document. The rejection is written to the context's event log with the
validation error, so the failure is diagnosable rather than merely visible.

### Adding a component is a security review

The catalog is fixed at 16 and grows only through review. A pull request adding a
component type must state what new capability the component grants the model, what
untrusted data can reach its props, what a hostile document could do with it, and why the
prop set is minimal. Adding a component enlarges the model's action surface. That is what
makes it a security change and not a UI change.

Components do not take arbitrary URLs, arbitrary HTML, style overrides or event handler
strings. Interactivity is expressed as declared, named actions that SairiOS resolves and
that route through the permission broker (ADR 0006) when they are privileged.

## Consequences

### Positive

- Prompt injection cannot become code execution through the UI path. The worst outcome of
  a hostile document is a rejected document and a logged error.
- The attack surface is enumerable. It is 16 component types with fixed props, and it can
  be read end to end in an afternoon.
- Every payload is inspectable, diffable, loggable and replayable. A UI bug report is a
  JSON document, so it reproduces exactly.
- The design language holds, because every pixel comes from hand-written, reviewed
  components rather than from generated markup.
- Rendering can be tested without a model. Fixture documents drive the whole surface.
- The renderer is swappable. The same document can drive a native shell later without
  changing the protocol.

### Negative

- Expressiveness is capped. Anything the catalog cannot say, the model cannot ask for, and
  the answer to "can we show X?" is sometimes no until a component ships.
- The catalog becomes a bottleneck, and the pressure to add components will be constant.
  Holding the line is ongoing work, not a one-time decision.
- Schema versioning is real work. Every protocol change needs a version bump, a migration
  story and a renderer that knows which versions it accepts.
- Models must be constrained to produce valid documents. That means prompt work, retries on
  validation failure, and a measurable rejection rate to watch.
- Whole-document rejection means one bad field costs the whole view. That is the intended
  trade and it will still feel harsh in practice.

### Neutral

- Validation runs on every document, in both the service and the shell. The cost is
  microseconds against a model call measured in seconds.
- The 16-component number is not sacred. What is sacred is that the catalog is finite,
  audited and enumerated.
- Prop-level string length bounds exist mainly to keep a hostile or broken document from
  producing an unrenderable page, not as a security boundary on their own.

## Alternatives considered

**Model-generated React or HTML, executed in the shell.** The obvious approach, and the
one most adjacent products take.
Rejected because: it is RCE-equivalent. The shell processes untrusted content, so any
untrusted content that reaches the model can influence the code the model emits, and that
code then runs in the user's session. This is not a hardening problem to be solved with
sanitizers. It is the wrong shape.

**Sandboxed iframe running generated code.** Put the generated code in a cross-origin
iframe with a strict CSP and a narrow `postMessage` channel.
Rejected because: for v0 the isolation is real, but the attack surface is large and it is
the kind of surface that fails quietly. Iframe sandbox escapes, CSP bypasses, message
channel confusion and browser-engine bugs are all live categories, and each one has to be
re-audited on every engine update. Auditing generated code is also not tractable: there is
nothing to review before it runs. It breaks the native look as well, because sandboxed
content cannot share the host's component instances or design tokens without opening the
channel further. This is the strongest rejected alternative and it may return for narrowly
scoped, user-initiated cases. It is not the default rendering path.

**A DSL that compiles to code.** Define a restricted language, have the model emit that,
compile it to components.
Rejected because: it is the same trust problem one step removed. If the DSL is expressive
enough to be worth having, it has control flow and composition, and now the project owns a
compiler and a language security model on top of everything else. If it is restricted
enough to be safe, it is a data format with worse ergonomics than JSON Schema. Choosing
JSON with a schema takes the safe end of that trade and stops.

**A fixed, non-adaptive UI.** Ship a conventional interface; drop the adaptive claim.
Rejected because: it gives up the product thesis. If every context looks the same
regardless of intention, SairiOS is a chat window next to a file browser, and the reason
for the project disappears.

## Revisit when

- The catalog stops being able to express real user needs, and the pattern of rejected
  requests points at a structural gap rather than at individual missing components.
- A genuinely auditable sandboxed execution model appears, with an isolation boundary the
  team can review in full and a native-look story that does not require widening the
  channel.
- The document rejection rate in real use stays high enough to be a usability problem, at
  which point the question is whether the schema is wrong, not whether validation should be
  relaxed.
- The catalog approaches roughly twice its current size, which is the point to ask whether
  it is still auditable or has quietly become a framework.
- A second renderer (native shell, mobile surface) is built, since that will test whether
  the protocol is genuinely renderer-independent or has absorbed web assumptions.
