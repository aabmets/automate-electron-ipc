# T130: One prefix for errors that name a schema file

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `file === undefined ? "" : \`Schema file '${file}': \`` is written five times
  (`validation/channel-validation.ts` three, `validation/clone-issues.ts` two), and
  `validation/global-validation.ts` writes the prefix out by hand.
- **Scope:** Add `schemaFilePrefix(file?)` to `src/parser/diagnostics.ts` and use it at the six
  sites. The texts of the errors stay word for word; the tests assert them.
- **Tests:** Same test count, no assertion changed.
- **Delivered:** 2026-10-09. `schemaFilePrefix(file?)` is in `src/parser/diagnostics.ts` and replaces the six hand-written prefixes. Texts unchanged, no assertion changed. 3290 tests (2 new, for the helper).
