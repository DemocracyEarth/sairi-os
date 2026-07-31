#!/usr/bin/env node
/**
 * Precompiles the SairiUI JSON Schema into a standalone ESM validator.
 *
 * Why this exists:
 *
 *   AJV compiles a schema by generating JavaScript and calling `new Function`.
 *   The SairiOS shell ships a Content Security Policy with `script-src 'self'`
 *   and no `'unsafe-eval'`, so runtime compilation is refused in the browser and
 *   the shell fails to mount.
 *
 *   Relaxing the CSP to `'unsafe-eval'` was the alternative and was rejected.
 *   The product's headline security property is that an agent cannot execute
 *   code in the user's environment; enabling eval for the whole document to save
 *   a build step would undercut exactly that.
 *
 *   So the validator is compiled here, at build time, into plain eval-free
 *   JavaScript. The renderer's validation — the last of the three checks between
 *   model output and the screen — keeps working under the strict policy.
 *
 * The context schema validator is NOT precompiled: it runs only inside the Node
 * services, where there is no CSP and no benefit.
 *
 * The generated file is committed, and `validate.test.ts` regenerates it and
 * fails if it differs, so it cannot drift away from the schema.
 *
 *   node packages/adaptive-ui-schema/scripts/build-validator.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '../src/schema/sairi-ui.schema.json');
const OUT = resolve(HERE, '../src/generated/sairi-ui-validator.js');

const HEADER = `// GENERATED FILE - DO NOT EDIT.
//
// Produced by packages/adaptive-ui-schema/scripts/build-validator.mjs from
// src/schema/sairi-ui.schema.json. Edit the schema, then run:
//
//   npm run build:validator -w @sairios/adaptive-ui-schema
//
// A test regenerates this and fails if it is stale, so the schema and this file
// cannot disagree.
`;

/**
 * AJV's `esm: true` still emits `require(...)` for its own runtime helpers
 * (`ucs2length` today). That is a syntax error in an ES module, so the calls are
 * hoisted into real imports here.
 */
function requiresToImports(source) {
  const specifiers = new Map();
  const nameFor = (specifier) => {
    if (!specifiers.has(specifier)) specifiers.set(specifier, `__sairi_dep_${specifiers.size}`);
    return specifiers.get(specifier);
  };

  // `require("x").default` first, then any bare `require("x")`. Both resolve to
  // the same binding: the helper function itself, unwrapped once.
  const body = source
    .replace(/require\("([^"]+)"\)\.default/g, (_m, specifier) => nameFor(specifier))
    .replace(/require\("([^"]+)"\)/g, (_m, specifier) => nameFor(specifier));

  const imports = [...specifiers].map(([specifier, name]) => {
    // Node's ESM resolver needs the extension; AJV's runtime files have none.
    const withExtension = /\.[cm]?js$/.test(specifier) ? specifier : `${specifier}.js`;
    const raw = `${name}__mod`;
    return (
      `import ${raw} from '${withExtension}';\n` +
      // Node hands a CJS default import the whole `module.exports`, so the helper
      // sits under `.default`. A bundler honouring `__esModule` unwraps it first.
      `const ${name} = typeof ${raw} === 'function' ? ${raw} : ${raw}.default;`
    );
  });

  return { body, imports };
}

export function generate() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  // `code.source` + `esm` produce a standalone module with no `new Function`.
  const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true, esm: true } });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const raw =
    typeof standalone === 'function'
      ? standalone(ajv, validate)
      : standalone.default(ajv, validate);

  // "use strict" is redundant in a module and would sit above the imports.
  const { body, imports } = requiresToImports(raw.replace(/^"use strict";/, ''));
  const code = `${HEADER}${imports.join('\n')}${imports.length ? '\n' : ''}${body}\n`;

  // The whole point of this file is that it contains no runtime code generation.
  // Assert it, so a future AJV release cannot silently reintroduce eval.
  for (const forbidden of ['new Function', 'eval(', 'require(']) {
    if (code.includes(forbidden)) {
      throw new Error(
        `generated validator contains "${forbidden}", which the shell's Content Security Policy forbids`,
      );
    }
  }
  return code;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const code = generate();
  if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== code) {
      console.error(
        'sairi-ui-validator.js is stale. Run: npm run build:validator -w @sairios/adaptive-ui-schema',
      );
      process.exit(1);
    }
    console.log('sairi-ui-validator.js is up to date.');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, code);
    console.log(`wrote ${OUT} (${code.length} bytes)`);
  }
}
