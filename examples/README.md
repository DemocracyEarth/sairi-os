# Examples

Reference payloads for the two SairiOS protocols. Every file here is checked by
[examples.test.ts](examples.test.ts), so the documentation cannot drift away from
the schemas.

## `sairi-ui/`

SairiUI documents: what an agent returns and what the shell renders.

| File                                  | Valid  | Shows                                                                           |
| ------------------------------------- | :----: | ------------------------------------------------------------------------------- |
| `ephemeral-vendor-comparison.json`    |  yes   | A bounded task: comparison table, criteria checklist, recommendation, sources   |
| `persistent-sairios-development.json` |  yes   | Ongoing work: status panel, tasks, decisions, files, host-rendered activity log |
| `crystallized-weekly-briefing.json`   |  yes   | A reusable workflow: agenda, source library, stage timeline, briefing template  |
| `rejected-unknown-component.json`     | **no** | A component outside the catalog rejects the whole document                      |
| `rejected-injected-props.json`        | **no** | Undeclared props (event handlers, raw HTML) are refused                         |

The two rejected files are the more important ones. They are the specification
of the boundary between model output and the screen: SairiOS validates first and
renders second, and a document that fails validation renders **nothing** — not
even the regions that would have passed.

## `contexts/`

Complete `Context` documents matching `packages/context-schema`, one per context
type. These are the same three contexts the context service seeds into an empty
store, so a fresh install shows the product thesis instead of a blank screen.

Read `crystallized-weekly-briefing.json` alongside the other two: its `template`
field is what survives crystallization, and everything absent from it — the
conversation, the files, the execution log — is what the sanitizer removed.

## Regenerating

The valid files are exported from the seeded demo contexts, so they stay in step
with the code:

```bash
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { demoContexts } from './services/context-service/dist/seeds.js';
const names = { ephemeral: 'ephemeral-vendor-comparison', persistent: 'persistent-sairios-development', crystallized: 'crystallized-weekly-briefing' };
for (const c of demoContexts()) {
  writeFileSync('examples/sairi-ui/' + names[c.type] + '.json', JSON.stringify(c.uiSpecification, null, 2) + '\n');
  writeFileSync('examples/contexts/' + names[c.type] + '.json', JSON.stringify(c, null, 2) + '\n');
}
"
```

Run `make build` first so `dist/` exists.
