# Roadmap

SairiOS is an experiment. This roadmap says what has been built, what has been
built but not verified, and what comes next. It is deliberately specific about
the difference.

A claim moves out of "not verified" only when somebody has run the thing and
said so, with the date. "It should work" is not a verification, and neither is a
passing unit test against a fake.

_Last reconciled against the tree: 2026-08-02._

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
- [x] English default, Spanish fully supported: every key in both, dictionary and
      interpolation-placeholder parity asserted, a stored preference always beats
      the default
- [x] The logo, drawn as geometry rather than text so it has no font dependency:
      menu bar, first-run setup, favicon, session icon, README
- [x] End-to-end test of the full flow in mock mode against the real services
- [x] 302 tests, none requiring a credential or the network

### Verified by actually running it

Each of these was moved here by doing it, not by reasoning about it. Four real
faults in the VM path were found this way and are in the commit history.

- [x] **The VM image builds from scratch and boots.** QEMU on macOS arm64,
      Debian 12, cloud-init provisioned, guest self-check `fail: 0` / `DEGRADED`.
      Rebuilt from scratch three times on 2026-08-02 and reproduced each time.
- [x] **The full stack runs in the guest**: guest shell, guest context service,
      guest SQLite, real contexts, as hardened systemd units running `User=sairi`.
- [x] **A cold boot reaches the desktop unattended** — `up 0 minutes`, every unit
      active, no manual step. Verified by screenshot from inside the guest's own
      compositor. `cage` cannot scan out without GL and QEMU here provides none,
      so the session runs `weston --use-pixman` with `kiosk-shell`;
      `SAIRIOS_COMPOSITOR=cage` remains for machines with real GL.
- [x] **OpenClaw is installed in the image** at the pinned version, verified by
      running the binary in the guest, and the gateway units provision correctly.

### Built but NOT verified

- [ ] **The OpenClaw wire protocol.** The frame shapes in
      `services/agent-bridge/src/providers/openclaw.ts` are **placeholders**. The
      connection lifecycle is unit-tested against a fake transport; nothing in
      SairiOS has ever exchanged a message with a live gateway.
      See [docs/OPENCLAW.md](docs/OPENCLAW.md), which states the split precisely.
- [ ] **First-run provider setup against the real binary.** The flow is written,
      unit-tested and reachable on the VM, and its `openclaw onboard` flags come
      from upstream's CLI automation reference — but that command has never been
      executed. The first person to enter a key is the first to run it.
- [ ] **Docker development services** — Compose file and Dockerfiles written and
      reviewed, never built.

### Known and deliberately unfinished

Not bugs to be discovered later; they are listed because they are already known.

- **Eight of the eleven capabilities are simulated.** Only `files.read`,
  `files.write` and `files.delete` produce a real side effect. The `simulated`
  flag is accurate and surfaced in the UI, but a user's first real task will
  meet it.
- **A granted permission cannot be revoked.** See Milestone 2.
- ~~The seeded "SairiOS development" context is stale.~~ Fixed: it now reports
  the VM as booting, OpenClaw as pinned-but-unverified, and 3 of 11 capabilities
  as real.

### Deliberately not in this milestone

- Custom Wayland compositor. v0 runs the shell fullscreen under `weston` in
  kiosk mode.
- Tauri packaging. The path is documented; the shell runs in a browser for now.
- Kernel work of any kind.
- A production cloud backend. The seam is designed, the implementation is local-only.
- Voice input.
- Real network fetching. `network.fetch` is simulated.

## Milestone 1 — make the unverified list empty

**Goal:** turn what is written into what is demonstrated. Nothing new until what
exists is real.

1. **Meet a live gateway.** This is the one that gates everything else, because
   the product's central claim — a model returns a validated SairiUI document
   and the broker mediates every action — has only ever run against the mock.
   Enter a key on the VM, capture real gateway frames, reconcile the codec
   against them, freeze the frames as fixture tests, then move
   `openclaw/config/version.json` from `pinned` to `verified`.
   Expect the placeholders to be wrong on first contact.
2. **CI, which does not exist.** There is no `.github/` in this repository at
   all. Run `make validate` plus a headless VM boot smoke test on every PR.
   Several boot-path changes have been verified only by hand, twice needing a
   full image rebuild to catch something a test would have caught in seconds.
3. **Persistence across a reboot.** Create a context in the guest, crystallize
   it, reboot, and confirm both survive. The boot is verified; this specific
   round trip is not.
4. **Build and run the containers.** Confirm the hardening directives do what
   the comments claim.
5. ~~**One palette, not two.**~~ Done. `tokens.css` is canonical and
   `os/branding/palette.css` is generated from it by `build-palette.mjs`, with
   `palette.test.ts` failing on drift. The 65-token parallel vocabulary that
   existed only in the old file is gone. One thing left behind:
   `sairios-wallpaper.svg` still holds literals from the pre-consolidation
   palette and does not match — harmless while the session draws no wallpaper,
   and recorded in the file itself.

Exit criterion: the "Built but NOT verified" list is empty and every claim in
the README has been demonstrated.

## Milestone 2 — contexts that hold up under use

**Goal:** make a persistent context worth returning to after a month.

- **Revoking a permission.** A remembered grant has no expiry and no removal
  path: nothing clears it when its context is archived, and there is no endpoint
  to withdraw it. Visibility without control is only half a permission system.
  This is the first thing to fix in the broker, and it is a much smaller job
  than anything below it.
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
- Retire the remaining simulated capabilities, or state per capability why one
  stays simulated.

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
  The provider-credential path added in
  [ADR 0010](docs/adr/0010-provider-credential-custody.md) belongs in that
  review: it is the only place SairiOS takes custody of a secret.

## Milestone 4 — contexts that move

**Goal:** a context that starts on a desktop and continues elsewhere.

- Implement `ContextSyncProvider` against a real backend, keeping syncable and
  device-local state separated.
- Conflict handling better than last-writer-wins (CRDTs are the likely answer;
  see [ADR 0007](docs/adr/0007-cloud-sync-boundary.md)).
- `SecretProvider` backed by the OS keychain. This would also replace the 0600
  file that currently holds the provider credential.
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
- **Will a real model produce documents this catalog accepts?** Untestable until
  Milestone 1 item 1. The skill file teaches the protocol, but a rejection rate
  high enough to be annoying would be an argument about the catalog, not the
  model.
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
