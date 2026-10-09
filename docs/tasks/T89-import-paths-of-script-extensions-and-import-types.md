# T89: Import paths of script extensions, JSON modules and import types

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09.
  - Without `projectUsesNodeNext`, the generated imports drop the extension of a `.mts` or `.cts`
    schema file (`./schema/api`) and of an `.mjs` or `.cjs` specifier (`./models.mjs` becomes
    `./models`). Neither resolves (TS2307); they need `.mjs` or `.cjs`.
  - With `projectUsesNodeNext`, `.js` is added to a specifier that has an extension that is not a
    script one: `./settings.json` becomes `./settings.json.js`.
  - An import type in a signature, `import("./models").User`, is copied as it is, so its path is
    relative to the schema file and not to the generated files.
- **Scope:** keep `.mjs`/`.cjs` for the module extensions in both modes; add `.js` only to a
  specifier without an extension; record the argument of a `TsImportType` as a reference and
  rewrite it with `resolveImportPath`. The value imports of validators and the serializer import
  use the same code.
- **Tests:** the `it.fails` of `T89` in `tests/test_e2e/generatorFindings.test.ts` turn into
  passing tests, with the fixtures `script-extensions`, `json-import-node-next` and
  `inline-import-types`.
- **Delivered:** 2026-10-09. The `.mts`/`.mjs` and `.cts`/`.cjs` extensions stay in both modes (the
  ids of modules treat `a.mts` and `a.mjs` as one file). NodeNext adds `.js` only to a specifier
  without an extension, where an extension is a script one or one of a list of data extensions
  (`.json`, `.node`, `.wasm`, styles, images, `.md`...): other dots, as in `user.model`, belong to the
  name (T55). `TsImportType` arguments that start with `.` are recorded as `typeRefs` with an
  `importPath` and rewritten by `getChannelSpecs` through `resolveImportPath`, in signatures and
  error types. The fixture `json-import-node-next` got `"type": "module"`, which the import
  attribute of its schema file needs under NodeNext.
