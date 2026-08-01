# Roadmap

SairiOS is an experiment. This roadmap says what has been built, what has been
built but not verified, and what comes next. It is deliberately specific about
the difference.

## Milestone 0 — vertical slice (current)

**Goal:** one working path through every layer, rather than many half-built
subsystems.

### Done and tested

- [x] Context domain model with a versioned JSON Schema
- [x] Context lifecycle state machine, in one module, fully tested
- [x] Crystallization with allow-list sanitization and a user-visible preview
- [x] SairiUI declarative protocol: JSON Schema, sixteen-component audited catalog
- [x] Whole-document validation with a safe error state
- [x] Permission broker: observation / proposal / execution, eleven capabilities,
      four grant scopes, policy re-check at execution, append-only audit log
- [x] Sandbox path containment, symlink-aware
- [x] Context service with SQLite (`node:sqlite`) and JSON stores
- [x] Agent bridge with a provider interface; deterministic offline mock provider
- [x] Desktop shell: global menu, context map, intention entry, context windows,
      permission panel, crystallization preview
- [x] Restricted markdown renderer that never emits HTML
- [x] Three seeded demo contexts, one per type
- [x] End-to-end test of the full flow in mock mode against the real services
- [x] 205 tests, none requiring a credential or the network

### Built but NOT verified

- [x] **VM image builds and boots.** QEMU 11.0.3 on macOS arm64: image built,
      Debian 12 booted, cloud-init provisioned, guest self-check reported
      `ok: 18  warn: 6  fail: 0` / `DEGRADED` over the serial console. Four real
      faults were found and fixed by running it — see the commit history.
- [ ] **The graphical session has not been watched come up.** `/dev/dri/card0`
      exists so `cage` can start, but nothing has confirmed it renders.
- [ ] **OpenClaw provider** — connection lifecycle implemented and unit-tested
      against a fake transport; the wire protocol has never met a live gateway.
      See [docs/OPENCLAW.md](docs/OPENCLAW.md).
- [ ] **Docker development services** — Compose file and Dockerfiles written and
      reviewed, never built.

### Deliberately not in this milestone

- Custom Wayland compositor. v0 runs the shell fullscreen in `cage`.
- Tauri packaging. The path is documented; the shell runs in a browser for now.
- Kernel work of any kind.
- A production cloud backend. The seam is designed, the implementation is local-only.
- Voice input.
- Real network fetching. `network.fetch` is simulated.

## Milestone 1 — a machine that boots

**Goal:** turn the three unverified items above into verified ones. Nothing new
until what exists is real.

1. **Boot the VM end to end.** Build the image, boot it, reach the SairiOS
   session, create a context, crystallize it, reboot, confirm it is still there.
   Record what actually happened, including what broke.
2. **Verify the OpenClaw integration.** Pin a release, capture real gateway
   frames, reconcile the codec, add fixture tests, update the pin file.
3. **Build and run the containers.** Confirm the hardening directives do what
   the comments claim.
4. **CI.** Run `make validate` plus a headless VM boot smoke test on every PR.
5. **One palette, not two.** `os/branding/palette.css` and
   `packages/ui-components/src/styles.css` both declare `--sairi-*` tokens, nothing
   imports the former, and the nine tokens they share currently disagree on every
   value. Pick which file is canonical and make the other derive from it, so the
   login screen and the shell cannot drift apart.

Exit criterion: the "Built but NOT verified" list is empty and every claim in
the README has been demonstrated.

## Milestone 2 — contexts that hold up under use

**Goal:** make a persistent context worth returning to after a month.

- Context memory that is actually used: retrieval, summarization, and an
  explicit distinction between durable and working memory in the UI.
- Artifacts as first-class citizens: import files into a context sandbox, track
  provenance, mark untrusted content everywhere it surfaces.
- Sub-contexts. An investigation should be able to spawn a bounded task without
  losing the thread.
- Search across contexts, scoped by type and status.
- Crystallization round-trip in anger: run a template ten times, then improve
  the template from what the runs taught you.
- Real `network.fetch` behind an egress policy, with fetched content marked
  untrusted end to end.
- **Revoking a permission.** A remembered grant currently has no expiry and no
  removal path: nothing clears it when its context is archived, and there is no
  endpoint to withdraw it. Visibility without control is only half a permission
  system. This is the first thing to fix in the broker.

## Milestone 3 — isolation worth the name

**Goal:** make the sandbox a boundary rather than a convention. This is the
prerequisite for anything running unattended.

- Per-context isolation: containers first, then microVMs (Firecracker or
  equivalent) for contexts that execute tools.
- A capability broker that survives a compromised agent process.
- Tamper-evident audit log.
- Supply-chain work: SBOM, dependency pinning with provenance, reproducible
  image builds.
- A security review of the whole boundary set by someone who did not write it.

## Milestone 4 — contexts that move

**Goal:** a context that starts on a desktop and continues elsewhere.

- Implement `ContextSyncProvider` against a real backend, keeping syncable and
  device-local state separated.
- Conflict handling better than last-writer-wins (CRDTs are the likely answer;
  see [ADR 0007](docs/adr/0007-cloud-sync-boundary.md)).
- `SecretProvider` backed by the OS keychain.
- `RemoteExecutionProvider`: run a context's work on a cloud VM, still gated by
  the same permission broker.
- A mobile viewer. Read and approve, not author.

## Milestone 5 — the environment becomes the product

- A richer compositor, or a real Wayland shell, once there is evidence about
  what context windows actually need.
- Tauri packaging for desktop distribution.
- Multi-user support, which the current no-authentication posture rules out.
- An installable image somebody who is not a contributor could reasonably run.

## Open questions

Recorded because they are unresolved, not because they are scheduled.

- **How much UI should a model design?** The catalog constrains it deliberately.
  Sixteen components may be too few to be expressive or too many to audit well.
  Usage will tell.
- **When should a context crystallize itself?** Suggesting it after N similar
  runs is obvious; getting the threshold right without being annoying is not.
- **What does context memory forget?** A persistent context that never forgets
  becomes unusable. Scope (`durable` / `working` / `ephemeral`) is a first
  answer, not the answer.
- **Is `waiting` one status or several?** Waiting on a permission, on a human
  decision, and on an external system are different things.
- **How do two people share a context** without sharing everything inside it?
  Crystallization is the current answer and it is probably not the whole one.

## Non-goals

- Replacing Linux. SairiOS is an operating _environment_.
- Being a general-purpose agent framework. It is an environment, not an SDK.
- Running arbitrary untrusted third-party code. That is a different product with
  a different threat model.
- Shipping a chat interface. See [CLAUDE.md](CLAUDE.md).
