# Architecture decision records

This directory holds the architecture decision records (ADRs) for SairiOS. An ADR is a
short document that records one significant decision, the situation that forced it, and
what the project accepted in exchange. ADRs are written for the person who joins the
project in a year and asks "why is it like this?" They are not design documents, not
specifications and not tutorials. Those live elsewhere under `docs/`.

## What counts as a decision worth recording

Record a decision when it is hard to reverse, when it constrains other work, or when a
reasonable engineer would otherwise re-litigate it every few months.

Concretely, write an ADR when the decision:

- fixes a boundary between components (what talks to what, and through which interface),
- picks a base platform, runtime, language or distribution mechanism,
- establishes or changes a trust boundary or a security posture,
- introduces a new external dependency that would be expensive to remove,
- rejects an obvious alternative that a newcomer would otherwise try,
- changes a data format that is written to disk or crosses a process boundary.

Do not write an ADR for a naming choice, a lint rule, a refactor that leaves interfaces
intact, or a library swap with no API consequences. Those belong in the commit message
or the pull request.

## Format

Every ADR uses exactly this structure. Do not add or reorder top-level sections.

```
# NNNN. Title
- Status: Accepted
- Date: YYYY-MM-DD
- Deciders: <who decided>
## Context
## Decision
## Consequences
### Positive
### Negative
### Neutral
## Alternatives considered
## Revisit when
```

Section rules:

- **Context** states the forces at play: constraints, requirements, and what was true at
  the time. It does not argue for the outcome. If the context is written honestly, the
  decision reads as one of several defensible responses to it.
- **Decision** is written in the active voice and in the present tense: "SairiOS uses",
  not "we will probably use". It states what is done, not what is hoped.
- **Consequences** must include real entries under Negative. An ADR with no costs is an
  advertisement, not a record. Neutral holds the consequences that are neither wins nor
  losses but that someone needs to know about.
- **Alternatives considered** lists each option that was genuinely on the table, and ends
  each one with a line beginning `Rejected because:`. If an alternative was close, say so
  and name the specific fact that would have flipped the decision.
- **Revisit when** lists concrete, observable triggers. "When requirements change" is not
  a trigger. "When the image exceeds 4 GB" is.

## Numbering

- Files are named `NNNN-kebab-case-title.md`, zero-padded to four digits, starting at
  `0001`.
- Numbers are assigned in the order ADRs are merged and are never reused, never renumbered
  and never reordered, even if an ADR is later superseded.
- If two branches claim the same number, the second one to merge takes the next free
  number and updates its filename and heading before merge.
- The number in the `# NNNN. Title` heading must match the filename.

## Status values

- `Proposed`: under discussion, not yet binding.
- `Accepted`: in force. This is the normal state of a merged ADR.
- `Superseded by NNNN`: replaced. The old file stays exactly where it is, with its
  content unchanged apart from the status line.
- `Deprecated`: no longer applies and nothing replaced it.

Accepted ADRs are not edited to reflect new thinking. Reversing a decision means writing a
new ADR that supersedes the old one, and editing only the old status line to point at it.
Small corrections (a broken link, a typo, a wrong path) are fine.

## Writing a new one

1. Copy the structure above into `docs/adr/NNNN-<title>.md` with the next free number.
2. Fill in Context before Decision. If Decision is easy to write and Context is hard, the
   decision has probably not been examined.
3. Name the alternatives you actually rejected, including the one you liked.
4. Open a pull request. The ADR is reviewed as part of the change that implements it,
   or immediately before it.

## Index

| ADR                                                | Title                                                        | Status   |
| -------------------------------------------------- | ------------------------------------------------------------ | -------- |
| [0001](0001-linux-distribution-not-kernel-fork.md) | Build on a Linux distribution, not a kernel fork             | Accepted |
| [0002](0002-qemu-for-system-testing.md)            | QEMU for full-system testing, Docker for services            | Accepted |
| [0003](0003-declarative-adaptive-ui.md)            | Declarative adaptive UI, never generated code                | Accepted |
| [0004](0004-openclaw-behind-agent-bridge.md)       | OpenClaw as a pinned dependency behind the agent bridge      | Accepted |
| [0005](0005-contexts-as-primary-abstraction.md)    | Contexts as the primary abstraction                          | Accepted |
| [0006](0006-permission-broker.md)                  | A permission broker mediates every privileged action         | Accepted |
| [0007](0007-cloud-sync-boundary.md)                | Define the cloud boundary now, ship local-only               | Accepted |
| [0008](0008-npm-workspaces-and-typescript.md)      | npm workspaces and TypeScript, Rust where it earns it        | Accepted |
| [0009](0009-precompiled-schema-validator.md)       | Precompile the SairiUI validator instead of allowing eval    | Accepted |
| [0010](0010-provider-credential-custody.md)        | SairiOS takes custody of a provider key, and what that costs | Accepted |
