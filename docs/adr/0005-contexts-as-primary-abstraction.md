# 0005. Contexts as the primary abstraction

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

Every general-purpose computing environment in use today organizes itself around
applications and documents. You want to do something, so you pick a program, the program
opens a file, and the work exists as whatever residue those two leave behind. The
intention itself, the thing you were actually trying to do, is never represented anywhere.
It lives in the user's head, and the machine spends its time asking the user to translate
it into launches and file paths.

The cost is familiar enough to be invisible. Work spreads across a browser, a terminal, a
note, a chat and four folders. Nothing knows those pieces are related. Close the window and
the association is gone. Return in a week and reconstructing where you were takes longer
than the remaining work. Agents make it worse rather than better: an agent needs to know
what you are trying to do, what it may touch, what it already learned and what it already
did, and none of that has a home in a document-and-application model.

SairiOS starts from the position that the intention is the thing worth representing. If it
is a first-class object, then memory attaches to it, permissions scope to it, files belong
to it, agent work happens inside it, and the interface can be assembled for it. If it is
not, all of those become loose objects that some other system has to correlate, and
correlation after the fact never works well.

## Decision

The **context** is the primary abstraction in SairiOS. A context is a human intention
together with everything that intention accumulates: memory, files, tools, agents,
permissions, tasks, events and UI state.

Windows, files and conversations are **projections** of a context, not the primary objects.
A window is a view onto a context. A file is a resource belonging to a context. A
conversation is one event stream within a context. The internal formulation is: **every
window is a context**.

### Three types

- **Ephemeral.** A bounded task with a clear finish. "Work out why the build broke."
  Expected to end, and to auto-archive when it completes.
- **Persistent.** A long-lived workspace with no natural end. "The Q3 planning work."
  Accumulates memory and returns to activity repeatedly.
- **Crystallized.** A stabilized, reusable workflow. A context that has been done enough
  times that its shape is known and can be instantiated again with new inputs.

Crystallization is where the model earns its keep, and the formulation matters:
**applications are crystallized contexts**. What a conventional system ships as an
application is, here, a context whose structure stabilized. The path from "I did this once"
to "this is a thing I have" is a promotion within one model, not a rewrite into a different
one. There is no separate concept of an app to build, install or launch.

### Lifecycle

A context has exactly one status at a time, drawn from a fixed set:

| Status      | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `draft`     | An intention that has been stated but not started.                     |
| `active`    | Work is happening: an agent is running or the user is editing.         |
| `waiting`   | Blocked on a human. Almost always a pending permission decision.       |
| `completed` | Finished. Reopening is allowed, because intentions come back.          |
| `archived`  | Put away. Restorable. Nothing is destroyed by archiving.               |
| `failed`    | Ended badly. Terminal only by choice; a failed context can be retried. |

Legal transitions are enumerated, not implied. `waiting` exists as a distinct status rather
than as a flag on `active` because "the system is working" and "the system is stopped
until you answer" are different situations for the user and must be different in the model.
`archived` is restorable and never destructive; deletion is a separate, explicit act.

### One state machine

All lifecycle logic lives in **one** state machine
(`packages/context-schema/src/lifecycle.ts`). Nothing else decides whether a transition is
legal. UI components ask the state machine and render its answer; they do not encode rules.
Services ask the state machine; they do not shortcut it.

This is the operative rule of this ADR, and it is stated as a rule because the failure mode
is so predictable. Lifecycle logic scattered across UI components produces a system where a
context can be completed from one screen but not another, where a button is enabled in a
state it should not be, and where nobody can say what the rules are without reading the
whole frontend. Keeping it in one module means the rules are readable in one file, testable
in one test file, and changeable in one place.

Implicit transitions belong in the state machine too. An ephemeral context auto-archiving
on completion is a rule of the machine, not something a view does on the side.

## Consequences

### Positive

- The user's actual unit of work is represented, so it can be listed, resumed, searched,
  shared and reasoned about.
- Memory, permissions, files and events have an obvious owner. "Which context is this for?"
  always has an answer, which is what makes per-context permission grants (ADR 0006) and a
  meaningful audit trail possible at all.
- Agents get a scope. An agent works inside a context, sees that context's memory and
  files, and is bounded by that context's permissions.
- Adaptive UI has something to adapt to. The SairiUI document in ADR 0003 is generated for
  a context, with its type and status as inputs.
- Crystallization gives a path from ad hoc work to reusable capability without introducing
  a second concept.
- Resumption is real. Everything needed to pick up work is in one object.

### Negative

- It is unfamiliar. Users arrive with thirty years of application-and-document habits, and
  "make a context" is not yet an idea anyone has. Onboarding carries real weight.
- Everything routes through the context model, so a modeling mistake is expensive and shows
  up everywhere at once.
- Interoperating with the outside world means constant translation. The rest of the
  computing world speaks files and apps, and the boundary code is permanent.
- Granularity judgment falls on the user. When is this a new context and when is it part of
  an existing one? There is no mechanical answer, and getting it wrong produces either
  clutter or overloaded contexts.
- Six statuses and enumerated transitions are more machinery than a boolean, and every new
  feature must find its place in the machine rather than adding a flag.

### Neutral

- The context schema is validated and versioned like every other cross-boundary format in
  the project.
- Nothing here says a context maps to a single OS process. It does not, and the mapping
  between contexts and processes is a separate concern.
- Crystallization is a promotion in place: a crystallized context keeps its history rather
  than becoming a new object.
- Whether a context can contain another context is deliberately left open. v0 has a flat
  model, and nesting can be added without changing this decision.

## Alternatives considered

**Documents and applications.** The conventional model: users launch programs, programs
open files.
Rejected because: it is precisely the model the product exists to replace. It has no
representation for intention, no place to hang memory or permissions, and no way to
associate the parts of one piece of work. Adopting it and adding agents on top produces a
conventional desktop with a chat panel.

**A chat thread per task.** Make the conversation the unit; everything hangs off a
transcript.
Rejected because: a transcript collapses memory, permissions, files and objectives into a
single linear artifact with no structure. What was the goal, what was learned, what the
agent may touch and what was produced are all different kinds of thing, and burying them in
message order makes each one hard to query and impossible to enforce against. Permissions
in particular cannot be scoped to a scroll position. Conversation remains an event stream
within a context, which is the right place for it.

**A project or folder metaphor.** Group work into projects, like an IDE or a
document manager.
Rejected because: a folder is a container, not an intention. It has no objective, so
nothing can say whether it is done; no lifecycle, so it cannot be waiting on you or
finished; and no crystallization path, because a folder that gets reused is still just a
folder. It would deliver grouping, which is the least interesting part of what a context
provides.

## Revisit when

- Real usage shows contexts routinely need to nest or reference each other, which would
  force a composition model this ADR leaves open.
- Users consistently cannot decide what should be a context, indicating the granularity is
  wrong or the type distinction is not doing the work it should.
- The status set proves insufficient in practice, for example if `waiting` needs to
  distinguish waiting on a human from waiting on an external system. Adding a status is a
  change to one file, but it is a change to the shared vocabulary and deserves an ADR.
- Multi-user or shared contexts become a requirement, which introduces concurrent
  transitions the current single-owner machine does not model.
- Crystallization turns out to need its own object rather than being a context type, which
  would be the strongest signal that the unified model was too ambitious.
