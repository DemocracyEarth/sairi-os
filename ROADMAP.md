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
- [x] 338 tests, none requiring a credential or the network

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
- [x] **SairiOS speaks to a live gateway.** Handshake, envelope and
      request/response cycle verified 2026-08-03 against openclaw 2026.7.1-2.
      Real captured frames are committed at
      `services/agent-bridge/src/providers/gateway-frames.fixture.json` and the
      tests run on them. No credential was needed: the gateway starts with
      `--dev --auth none --allow-unconfigured`.
- [x] **Every flag first-run setup passes exists.** All eight, and every value
      (`--mode local`, `--secret-input-mode ref`, `--gateway-bind loopback`,
      both `--auth-choice` values) checked against `openclaw onboard --help` on
      the real binary.

### Built but NOT verified

- [ ] **An actual agent turn.** This is now the whole of the gap, and it is the
      only part that needs somebody's API key. `models.list` returns
      `{"models":[]}` on an unconfigured gateway. `sessions.create`,
      `sessions.send` and the `session.*` events exist in the vocabulary
      `hello-ok` advertised, so the names are right — but their params and
      payload shapes have not been observed, and neither has
      `exec.approval.resolve`.
- [ ] **First-run provider setup end to end.** Every flag and value it passes is
      now verified against the real binary, so the argv is right. The command
      itself has still never run. The first person to enter a key is the first
      to run it.
- [x] **Docker development services.** All four images build, the stack runs,
      and the hardening in compose.yaml is verified behaviourally: non-root,
      read-only root filesystem, `/tmp` writable but noexec, all capabilities
      dropped, no-new-privileges, pids capped, the sandbox with no route off the
      box, and no container mounting the Docker socket.

### Known and deliberately unfinished

Not bugs to be discovered later; they are listed because they are already known.

- **Eight of the eleven capabilities are simulated.** Only `files.read`,
  `files.write` and `files.delete` produce a real side effect. The `simulated`
  flag is accurate and surfaced in the UI, but a user's first real task will
  meet it.
- **A granted permission cannot be revoked.** See Milestone 2.
- **The OpenClaw approval relay is a new trust boundary, reviewed only by its
  author.** It decides whether an external agent runtime may act _outside_ the
  SairiOS sandbox, which makes it the most consequential seam added since the
  broker itself. It fails closed, never auto-allows, and refuses
  `process.execute` outright — but "I reasoned about it carefully and wrote
  tests" is not a review. First item for Milestone 3.
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

1. **Meet a live gateway.** Mostly done, and further than expected — the
   gateway starts unconfigured, so the handshake, the envelope, the
   request/response cycle and the full method vocabulary were all reachable with
   no credential at all.

   Done: codec reconciled against protocol 4, real frames frozen as fixtures,
   `version.json` moved from `pinned` to `handshake-verified`, and OpenClaw's
   approval round trip wired into the permission broker so a user is asked once
   rather than twice.

   The placeholders were wrong on first contact, exactly as predicted, and
   wrong at the root: the old codec switched on `frame.type` expecting an event
   _name_ there, but `type` is one of three _categories_ and the name lives in
   `event`. Every name it looked for was invented.

   Also corrected: `client.id` and `client.mode` are closed enums enforced
   server-side, and the `protocol.md` shipped _inside the openclaw package_
   shows a `client.mode` the gateway refuses.

   **Remaining, and it needs your key:** run one real turn. Capture the
   `sessions.create` / `sessions.send` params and the `session.*` and
   `exec.approval.*` payloads, add them to the fixture, and move
   `version.json` to `verified`.

2. ~~**CI.**~~ Done for the fast gate, and green on a real runner.
   `.github/workflows/ci.yml` runs on every push and PR: `make validate`, the
   boot path (shellcheck, `bash -n`, cloud-init YAML, `systemd-analyze verify`
   on all seven units, `desktop-file-validate`), a credential scan, and
   generated-file freshness. Verified: run 30769693247, all four jobs green.

   It found a real fault on its first run — `desktop-file-validate` rejects
   `DesktopNames`, which session files need and the base Desktop Entry Spec does
   not cover. Allowed by exact key name, so any other non-standard key still
   fails.

   Still outstanding: `vm-smoke.yml` has never run. It builds an image and boots
   it nightly, its timeout is a guess, and no local build has ever been amd64 —
   the only architecture a standard runner offers.

3. ~~**Persistence across a reboot.**~~ Done. A context was created in the
   guest, run through the bridge until it had a validated SairiUI document and
   eight events, crystallized, fingerprinted, and the VM cold-booted — QEMU
   killed and restarted from the qcow2, `up 1 day 7 hours` to `up 0 minutes`.
   Every field matched: ids, names, types, statuses, createdAt, event counts and
   a hash of the UI document. The template still instantiates into a fresh run.

   The check was built to defeat the ways it could falsely pass: seeding only
   runs on an empty store, so `totalContexts` staying at 5 rather than dropping
   to the 3 demo seeds is what proves the store was read rather than recreated.
   The driver was confirmed `sqlite`, not the JSON fallback.

   Two real faults found by doing it:

   - `Requires=` propagates a stop but not a start, so `systemctl restart
sairios-context-service` took the agent bridge down and left it down —
     silently, with no failure to restart because a propagated stop is a clean
     exit. Fixed with `PartOf=`, verified on the VM in both directions.
   - a crystallized template keeps the source context's **name** in its
     provenance event. Deliberate, but undocumented and untested until now.

4. ~~**Build and run the containers.**~~ Done, and the hardening is checked
   rather than asserted. `.github/workflows/containers.yml` builds all four
   images, runs the stack, creates and reads back a context through it, then
   verifies every claim in compose.yaml twice — once against the declared
   configuration and once by trying the forbidden thing and requiring it to
   fail. Verified: run 30777686875, every step green.

   Two real faults, both of which could only ever surface on a real build:

   - compose.yaml set the pids cap two ways at once (`pids_limit` plus the
     normalised `deploy.resources.limits.pids`), which made the whole project
     invalid.
   - the runtime stages copied only the root `node_modules`, so the production
     ajv@8 — which npm nests inside each schema package, because eslint's dev
     ajv@6 wins the root — never reached the image. Every image built cleanly
     and died on its first import.

5. ~~**One palette, not two.**~~ Done. `tokens.css` is canonical and
   `os/branding/palette.css` is generated from it by `build-palette.mjs`, with
   `palette.test.ts` failing on drift. The 65-token parallel vocabulary that
   existed only in the old file is gone. One thing left behind:
   `sairios-wallpaper.svg` still holds literals from the pre-consolidation
   palette and does not match — harmless while the session draws no wallpaper,
   and recorded in the file itself.

Exit criterion: the "Built but NOT verified" list is empty and every claim in
the README has been demonstrated.

**Where that stands:** three of five items are done. What is left is one real
agent turn (item 1, needs a key), one VM smoke run that has never executed (item
2), and the reboot round trip (item 3). Everything remaining is a thing to
_run_, not a thing to build — which is the position this milestone was supposed
to reach.

## Milestone 2 — contexts that hold up under use

**Goal:** make a persistent context worth returning to after a month.

- **Revoking a permission.** A remembered grant has no expiry and no removal
  path: nothing clears it when its context is archived, and there is no endpoint
  to withdraw it. Visibility without control is only half a permission system.
  This is the first thing to fix in the broker, and it is a much smaller job
  than anything below it.

  The OpenClaw approval relay raises the stakes: a relayed grant authorises an
  action _outside_ the sandbox, so "I take that back" needs to be expressible
  before that becomes routine.

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
  Two seams belong at the top of that review, both added recently and both
  reviewed only by their author:
  - **the OpenClaw approval relay**
    ([approval-relay.ts](services/agent-bridge/src/approval-relay.ts)) — it
    decides whether an external runtime may act outside the sandbox, and the
    `allow`-policy downgrade is the specific thing to attack;
  - **the provider-credential path**
    ([ADR 0010](docs/adr/0010-provider-credential-custody.md)) — the only place
    SairiOS takes custody of a secret.

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
