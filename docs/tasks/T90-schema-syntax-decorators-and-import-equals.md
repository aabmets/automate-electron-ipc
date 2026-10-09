# T90: Decorators and import-equals in schema files

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09.
  - swc parses the schema files without `decorators: true`, so a decorated class (an ORM entity in
    a model file of `schema/`) is a syntax error: `Expression expected`.
  - A name that `import X = ...` or `export import X = Ns.Y` declares is not bound, so a signature
    that uses it generates `main.ts` with TS2304 `Cannot find name`.
- **Scope:** parse with `decorators: true` (class and parameter decorators); handle
  `TsImportEqualsDeclaration`: an exported alias is imported from the schema file, and one that is
  not exported is resolved to its target.
- **Tests:** the `it.fails` of `T90` in `tests/test_e2e/generatorFindings.test.ts` turn into
  passing tests, with the fixtures `decorators` and `import-equals`.
- **Delivered:** 2026-10-09. `parseModule` passes `decorators: true`. `import X = ...` is a new
  `alias` kind of type spec: an exported alias (or one exported by `export { X }`) is imported from the
  schema file, one that is not exported carries `aliasOf` and the writers use its target, so
  `Models.User` or `Models_2.User` when the namespace is imported under another name. The require
  form `import X = require("./m")` that is not exported is recorded as a namespace import. The
  it.fails of T90 moved to `tests/test_e2e/ipcAutomation.test.ts`, with the fixtures
  `import-equals-local` and `import-equals-require` added. Not covered: `import X = Ns.Y` inside a
  namespace body, and `export =` in a schema file.
