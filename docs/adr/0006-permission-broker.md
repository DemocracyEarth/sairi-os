# 0006. A permission broker mediates every privileged action

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

SairiOS runs agents inside a user's environment. Those agents read files, fetch pages, open
applications and produce output, and they do it on behalf of a person who is not watching
every step.

The agent's input is untrusted, always. A file it reads, a page it fetched, a tool result,
a document a colleague sent: any of it can carry text written specifically to redirect the
agent. That is not an edge case to defend against occasionally. It is the normal operating
condition of a system that processes real-world content.

So the design question is not "how do we stop the model from being manipulated?" It cannot
be stopped, and any architecture whose safety depends on the model never being fooled is
already broken. The question is: **when the model is manipulated, what can it actually
do?**

That reframes the problem into architecture. The model's authority must be bounded by
something outside the model, and the boundary must be legible to a user in the moment they
are asked to widen it.

Two further requirements come from the context model in ADR 0005. Every privileged action
belongs to a context, so it can be attributed, audited and scoped. And a grant should be
able to mean "yes, for this piece of work", which is only expressible because contexts
exist.

## Decision

A **permission broker** (`services/permission-broker`) mediates every privileged action in
SairiOS. Nothing privileged happens outside it.

### Observation, proposal, execution

These three are separate, and separating them is the core of the design.

- **Observation.** The model reads state it is allowed to read. No side effects.
- **Proposal.** The model expresses an intended action as structured, schema-validated
  data: capability, target, arguments, and the context it belongs to. A proposal is inert.
  It is a description of an action, not the action.
- **Execution.** SairiOS, not the model, performs the action, after the broker has applied
  policy and, where required, the user has decided.

The model produces proposals. It never executes. The pathway from "the model wants
something" to "something happened" always passes through code SairiOS wrote and, for
anything not explicitly pre-allowed, through a human.

### Capabilities

Eleven capabilities, and only eleven. A privileged action that does not map to one of these
cannot be proposed.

```
files.read              files.write             files.delete
process.list            process.execute         network.fetch
browser.open            clipboard.read          clipboard.write
notifications.send      system.settings.read
```

### Policies

Each capability has one of three policies:

- **allow**: execute without asking.
- **ask**: suspend and put the decision to the user.
- **deny**: refuse; the user is not prompted.

### Default policy table

| Capability             | Default  |
| ---------------------- | -------- |
| `files.read`           | ask      |
| `files.write`          | ask      |
| `files.delete`         | **deny** |
| `process.list`         | allow    |
| `process.execute`      | **deny** |
| `network.fetch`        | ask      |
| `browser.open`         | ask      |
| `clipboard.read`       | **deny** |
| `clipboard.write`      | ask      |
| `notifications.send`   | ask      |
| `system.settings.read` | allow    |

The two `allow` defaults are read-only and low-consequence. The three `deny` defaults are
the ones where a single mistaken action is either irreversible (`files.delete`),
authority-granting (`process.execute`), or a silent exfiltration channel
(`clipboard.read`, which can hold a password a user copied a moment ago). `deny` means the
user is not asked, because asking normalizes the request.

### Grant scopes

When a capability is `ask`, the user gets four answers:

1. **Allow once**: this action only. The next one asks again.
2. **Allow for this context**: for the remainder of this context (ADR 0005). Scoped to
   one piece of work and gone when that work is archived.
3. **Deny**: refuse this action. Ask again next time.
4. **Deny and remember**: refuse and stop asking for this capability in this context.

"Allow for this context" is what makes the model usable rather than exhausting. It lets a
user say yes once for a task they understand, without granting anything to unrelated work.

### Requirements on every privileged action

Every privileged action, without exception:

- is **schema-validated** before the broker considers it, with unknown capabilities,
  unknown fields and malformed arguments rejected outright;
- is **logged** to an append-only audit record: capability, arguments, context, decision,
  scope, outcome, timestamp;
- is **attributable to a context**, so "what did this piece of work touch?" is answerable;
- is **visible to the user**, both as a prompt when policy requires and afterward in the
  context's activity log;
- is **cancellable where possible**. Long-running and streaming actions expose cancellation
  and cancel promptly. Where an action genuinely cannot be interrupted, that is stated in
  the prompt rather than discovered afterward.

### No unrestricted shell

There is **no unrestricted shell execution path from the model**. There is no capability
that takes a command string and runs it. `process.execute` defaults to `deny` and, when
enabled at all, is a structured invocation of an allow-listed program with validated
arguments. It is not a shell.

Agent file actions are confined to a sandbox directory (`SAIRIOS_SANDBOX_DIR`, default
`./var/sandbox`). Paths are resolved and checked against the sandbox root after symlink
resolution, so a symlink or a `..` sequence does not escape it. `files.read` being `ask`
rather than `deny` is about reading inside that boundary, not about the model roaming the
filesystem.

## Consequences

### Positive

- A successful prompt injection yields a proposal, not an action. The blast radius of
  manipulation is bounded by policy rather than by the model's judgment.
- The user's mental model matches the enforcement. What the prompt says is what the code
  does.
- "What did this context do?" and "what was it allowed to do?" are both answerable from the
  audit log.
- Grants expire with the work they were for, so authority does not accumulate silently over
  a session.
- Policy is data. Changing defaults, or shipping a stricter profile, does not mean changing
  the agent.
- One chokepoint means one place to add rate limiting, anomaly detection or stricter
  review later.

### Negative

- Prompts interrupt. Every `ask` is friction, and friction on a common path will be felt as
  the product being slow to get out of the way.
- Prompt fatigue is a live risk even with context-scoped grants. If the design gets the
  frequency wrong, users will approve reflexively and the whole mechanism degrades to
  theater. This has to be measured, not assumed.
- The broker is on the path of everything privileged, so it is both a latency cost and a
  single point of failure.
- Eleven capabilities is a coarse vocabulary. `network.fetch` does not distinguish a
  documentation site from an attacker-controlled endpoint, and finer granularity is future
  work.
- Capability-level policy plus context-level grants plus per-action decisions is genuinely
  more state than a simple system, and explaining it clearly in the interface is hard.
- Things users expect to just work will not, because the default is `deny` or `ask`. Some
  of that will read as the product being broken.

### Neutral

- The audit log is append-only and per-context, and it is the data source for the
  `activity-log` component in ADR 0003.
- Permission prompts render through the same validated SairiUI protocol as everything else,
  using the `permission-request` component. The prompt is not a special escape hatch in the
  UI layer.
- Policy defaults are configuration, so a deployment can tighten them. Loosening them is a
  decision an operator makes explicitly and visibly.
- The sandbox directory is a SairiOS-level boundary. OS-level confinement, if added, sits
  underneath it rather than replacing it.

## Alternatives considered

**Trust the model.** Let the agent act, rely on training and system prompts for safety.
Rejected because: the model's input is untrusted by construction, so this makes the
system's security a property of text the attacker partly controls. It fails the only
question that matters, which is what happens when the model is wrong.

**OS-level sandboxing only.** Confine the agent process with namespaces, seccomp, cgroups
or a similar mechanism and stop there.
Rejected because: taken as a sufficient answer, it constrains the process but says nothing
about the product's questions. It cannot attribute an action to a context, cannot express "allow for
this piece of work", and cannot produce a prompt a user can understand, because at that
layer the event is a syscall rather than "this context wants to read your tax return". OS
confinement is complementary and welcome underneath the broker. It is not a replacement for
it.

**A prompt on every call with no policy memory.** Ask the user every single time, remember
nothing.
Rejected because: it produces prompt fatigue and therefore trains users to approve without
reading, which is worse than a coarser policy that users actually consider. Volume of
prompts is inversely related to attention paid to each one. Policy memory scoped to a
context is the compromise: few enough prompts to stay meaningful, narrow enough grants to
stay safe.

**Allow-list specific actions ahead of time, with no runtime prompting.** Configure
everything up front.
Rejected because: it moves the entire decision to configuration time, when the user has no
idea what the work will need. It is also unusable for open-ended intentions, which is most
of what the product is for.

## Revisit when

- Measured prompt rates or approval latency show fatigue: users approving in under a second
  or approving essentially everything. That means the granularity or the defaults are
  wrong.
- A capability proves too coarse in practice. `network.fetch` with per-host scoping is the
  most likely first split.
- A capability needs to be added. Adding one enlarges the model's authority and requires
  its own ADR, not a pull request.
- OS-level confinement (namespaces, seccomp) is added under the broker, which changes what
  the sandbox directory has to guarantee on its own.
- Multi-user or shared contexts arrive, since a grant would then need an identity attached
  and "allow for this context" would stop being unambiguous.
- Any proposal appears to relax "no unrestricted shell". That is the load-bearing rule of
  this ADR, and reopening it means reopening the whole security model, deliberately and in
  writing.
