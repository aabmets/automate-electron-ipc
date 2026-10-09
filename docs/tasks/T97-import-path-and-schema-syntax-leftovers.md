# T97: Import paths and schema syntax left after T89 and T90

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T89 and T90.
  - Under NodeNext, a directory import such as `./models` (which resolves to `./models/index.ts`)
    gets `.js` appended, `./models.js`, which does not resolve. This was so before T89.
  - `import X = Ns.Y` inside a namespace body is not handled; only module-level import-equals is.
  - `export = X` in a module that a schema file imports with `import X = require(...)` is not covered.
- **Scope:** resolve directory imports to `./models/index.js` under NodeNext when the directory has
  an index file; handle or reject the two import-equals forms with a clear error.
- **Tests:** e2e fixtures that assert on the generated text and type-check it (NodeNext where needed).
- **Delivered:** 2026-10-09. Directory imports: under NodeNext a relative specifier with no script or data
  extension that names a directory with an `index` file (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
  `.mjs`, `.cjs`) becomes `./models/index.js` (`.mjs`/`.cjs` for module scripts), in named, namespace,
  value and import-type imports. A file of the same name wins, as in the compiler. Module ids resolve the
  directory too, so `./models` and `./models/index` share one import. Without NodeNext nothing changes.
  Import-equals forms: `import X = Ns.Y` inside a namespace body is handled and needed no code, since the
  compiler resolves it inside the exported namespace (`Api.User`), and the new fixture
  `import-equals-namespace` only pins that. `export =` in a module that a schema file imports with
  `import X = require()` is handled, the same, for a namespace and for a type (fixture `export-equals`).
  `export =` in the schema file itself is rejected: the "must be exported" error was too vague, and now
  says that `export =` is not supported and names the two valid forms. Not covered: directories whose
  entry point comes from a `package.json` (`main`, `exports`), and path mappings.
