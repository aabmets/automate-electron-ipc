# T67: Locale-dependent sorting remains in the writers and the global validation

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of Phases 0 and 1. T06 introduced `utils.compareStrings`
  because `localeCompare` depends on the process locale, but two uses are left:
  `BaseWriter.sortCallablesArray` (`a.localeCompare(b)`) and `validateGlobalChannelSpecs`
  (`relativePath.localeCompare`). `sv-SE` and `en-US` order `ä` differently, so the generated
  member order can differ between machines. The callable sort also compares whole callable
  strings, not names, so `sendFoo2: ...` and `sendFoo: ...` order by the `:` against `2` (code
  unit order and ICU order disagree). `validateGlobalChannelSpecs` also orders files differently
  from `ipcAutomation`, so the "first file" named in an error is not the first one processed.
  The T06 tests use only same-case ASCII names, so they pass with `localeCompare` as well, and
  `compareStrings` and `isSchemaSourceFile` have no direct unit tests.
- **Scope:** sort callables by member name with `compareStrings`, and sort files in
  `validateGlobalChannelSpecs` with the same normalized comparison as `ipcAutomation`.
- **Tests:** `sortCallablesArray` with mixed-case, underscore and digit names and the `bind` prefix;
  `compareStrings` and `isSchemaSourceFile` unit tests; a global validation test with `B.ts`
  and `a.ts`; an e2e check that the output has the same order whatever `LANG`/`Intl` locale is
  used (compare outputs of a `sv`-sorted and a code-unit-sorted expectation).
- **Delivered:** 2026-10-08. `sortCallablesArray` orders by prefix and then by member name (not the whole callable) with `compareStrings`, and `validateGlobalChannelSpecs` sorts files with the normalized comparison of `ipcAutomation`; no `localeCompare` is left in `src`. Added unit tests for both, `compareStrings` and `isSchemaSourceFile`, and a `sort-order` e2e fixture that is generated under mocked `sv`, `en`, phonebook and reversed `localeCompare`. Channel names must start with a lowercase ASCII letter, so the fixture exercises case, `_`, digits and a non-ASCII letter inside names. The upper-case file name case is covered by the validator unit test only, since biome rejects such fixture file names.
