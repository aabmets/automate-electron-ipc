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
- **Delivered:**
