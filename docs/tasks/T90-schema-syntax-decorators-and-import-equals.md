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
- **Delivered:**
