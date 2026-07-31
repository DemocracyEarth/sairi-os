# 0007. Define the cloud boundary now, ship local-only

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

SairiOS will eventually need to work across devices. A context started on a laptop should
be resumable on another machine, artifacts should be reachable from more than one place,
and some work will want to run somewhere other than the user's hardware.

None of that is a v0 requirement. v0 has to be excellent on one machine.

The trap is well known and goes in both directions. Build the backend now and the project
spends its early effort on servers, accounts, conflict resolution and an operational
burden, all before anyone has confirmed that the local product is worth syncing. Build no
seam at all and sync arrives later as a retrofit that rewrites the domain layer, because
every place that assumed a single device, a local path or a directly-held secret has to be
found and changed.

There is a specific version of this that is worse than the general case. Once contexts
synchronize, whatever is inside a context document travels. If secrets are stored in
context documents because that was convenient locally, then enabling sync silently uploads
credentials. That would be a decision made by accident, years earlier, by someone who was
not thinking about sync. The separation has to exist before the first byte moves.

## Decision

SairiOS **defines the cloud seam now and ships local-only**. The interfaces exist. Exactly
one implementation ships in v0.

### Four interfaces

- **`ContextSyncProvider`**: moves syncable context state between devices.
- **`SecretProvider`**: resolves a secret name to a secret value.
- **`ArtifactStore`**: stores and retrieves the binary output of contexts.
- **`RemoteExecutionProvider`**: runs work somewhere other than this machine.

### One implementation

`LocalOnlyContextSyncProvider` is the only implementation that ships. It is not a stub that
throws. It is the real, correct answer for a single-device installation: state is local,
authoritative and complete, and there is no remote to reconcile with. The other three
interfaces have local implementations of the same character (local secret resolution, local
artifact storage on disk, local execution). Nothing in v0 talks to a network service for
any of these.

No server component is built. No account system is built. No protocol is frozen.

### The load-bearing rule

Two rules carry the weight of this ADR. They are enforced in v0 even though nothing
synchronizes yet, because enforcing them later is the expensive part.

**1. Syncable context state and device-local state are separated.**

Every field of a context is classified. Syncable state is the intention, the objective,
memory, task structure, permission policy, references to files and artifacts, lifecycle
status and event history. Device-local state is window geometry, panel layout, scroll
position, absolute filesystem paths, process ids, cached renders, this machine's data
directory and anything else that is meaningless or wrong on another device.

They are separated in the schema, not merely by convention, so a field cannot drift into
the wrong class without someone changing a type.

**2. Raw secrets never enter a synchronized document.**

A context document carries **secret names**, never secret values. `SecretProvider` resolves
a name to a value locally, at the moment of use, in the process that needs it. The value is
never written into a context, never persisted alongside one, and never included in anything
a `ContextSyncProvider` could transmit.

This holds in v0, when nothing syncs. That is the point. If it only started holding on the
day sync shipped, it would already have been violated everywhere.

### Conflict handling placeholder

When sync does arrive, the v0 placeholder is **last-writer-wins with explicit conflict
reporting**. A losing write is not silently discarded: the conflict is surfaced to the user
with both versions available. This is written down as a placeholder, not as an answer, so
that nobody later mistakes it for a considered design.

## Consequences

### Positive

- v0 effort goes entirely into the local product, which is where the thesis is proven or
  disproven.
- The local product has no network dependency, no account requirement and no server
  outage. It works on a plane.
- Sync later is implementing an interface, not restructuring the domain.
- The syncable/device-local split forces an early, explicit answer to "what is actually
  part of a context?", which is a good modeling question regardless of sync.
- Secrets can never be accidentally uploaded, because context documents never contain them
  in the first place.
- No protocol is committed to, so the eventual wire format is designed with real usage
  data instead of guesses.

### Negative

- The interfaces add indirection that buys nothing today. A reader will reasonably ask why
  `ContextSyncProvider` exists when there is one local implementation, and the honest answer
  is "for a thing that does not exist yet".
- Interfaces designed without a real remote implementation are usually wrong in some
  detail. The shapes will need adjustment when a second implementation appears.
- The syncable/device-local classification adds a decision to every new context field, and
  the wrong answer is easy to give and easy to miss in review.
- `SecretProvider` indirection is more ceremony than reading an environment variable, for
  no visible v0 benefit.
- Users get no multi-device story, which is a real gap against expectations.

### Neutral

- The interfaces are unexercised by a remote in v0, so tests cover only the local
  implementations. A conformance suite is worth writing when the second implementation
  arrives, not before.
- Nothing here commits to whether a future backend is self-hosted, managed or both.
- ADR 0004 already keeps model provider credentials in OpenClaw's own configuration. This
  ADR covers secrets SairiOS itself handles on a user's behalf, which is a different set.
- `RemoteExecutionProvider` is the least developed of the four and may turn out to belong
  with the permission model in ADR 0006 rather than here.

## Alternatives considered

**Build the sync backend now.** Servers, accounts, protocol, storage, from the start.
Rejected because: it is premature, and it is premature in a way that costs more than time.
It diverts v0 effort into infrastructure, adds an operational burden the team does not have
capacity for, and freezes a protocol before anyone knows what contexts really look like in
use. It also changes the severity of bugs: in a local product a sync bug is a bug, and in a
synchronizing product a sync bug is data loss. Taking on that class of failure before the
local product is proven is the wrong order.

**No interface at all.** Write the local product directly; add sync when it is needed.
Rejected because: retrofitting sync rewrites the domain layer. Every direct filesystem
access, every absolute path in a document, every assumption of a single authoritative copy
and every secret stored inline becomes a migration. The most damaging case is secrets: by
the time sync ships, credentials would be sitting inside context documents and someone
would have to find and remove all of them, in shipped user data. The seam is cheap now and
extremely expensive later.

**CRDTs now.** Adopt conflict-free replicated data types so multi-device editing works
correctly from the start.
Rejected because: for v0 it is disproportionate today. CRDTs are very likely the right
eventual answer, and this is not a rejection of the technique. But they impose a data model
on every context field, complicate persistence and debugging, and add a dependency, all in
service of concurrent editing that cannot happen because there is exactly one device.
Adopting them before the context model has stabilized would mean encoding a moving target
into a merge strategy. Last-writer-wins with explicit conflict reporting is the recorded
placeholder, and it is recorded precisely so it is not mistaken for the destination.

**Sync through an existing file-sync product.** Put the data directory in a
consumer file-sync folder and call it done.
Rejected because: file-level sync of a live database produces corruption rather than
merges, it has no concept of syncable versus device-local state, and it would carry secrets
if any ever landed in the data directory. It would also make correctness depend on a
third-party client the project cannot test against.

## Revisit when

- Multi-device use becomes a real user requirement rather than an anticipated one, evidenced
  by actual requests rather than by roadmap ambition.
- The local product is proven enough that the context model has stopped changing shape,
  which is the precondition for designing a sync protocol worth keeping.
- A concrete need appears for remote execution, for example a long-running context that
  should continue with the laptop closed.
- Artifacts grow large enough that local-only storage becomes a practical limit.
- Concurrent editing of a single context by one user across devices becomes real, which is
  the trigger to replace last-writer-wins and to take CRDTs seriously.
- Any proposal appears that would put a secret value inside a context document. That is the
  rule this ADR exists to protect, and it should be refused at review rather than
  rediscussed.
