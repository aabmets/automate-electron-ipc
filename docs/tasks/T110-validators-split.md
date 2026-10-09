# T110: Split `validators.ts`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/validators.ts` is 688 lines. The tests import it as the default export `vld`.
- **Scope:**
  - Split into: config validation (`validateOptionalConfig` and the trigger, origin and scope
    structs), channel spec structs and validation (`getChannelSpecStruct`,
    `validateChannelSpecWithStruct`, count and timeout limits), clone warnings, and the global
    validation (`validateChannelSpecs`, `validateGlobalChannelSpecs`, `validateReservedApiNames`,
    `validateTypeSpecs`).
  - Decide in the plan whether the default export `vld` stays as an object that gathers the
    functions, or callers import the functions. Either way, no re-export barrel.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:** 2026-10-09. Six modules: `config-validation.ts`, `option-structs.ts`,
  `channel-spec-structs.ts`, `clone-issues.ts`, `channel-validation.ts` and `global-validation.ts`.
  The default export `vld` is gone: callers import the functions, with no barrel. The output of
  all 95 fixtures is byte-identical. The per-file branch gate failed for `channel-validation.ts`
  after the split, so its dead `spec?.kind` guard (the struct has already accepted the spec) was
  dropped, and `tests/channel-validation.test.ts` covers the error without a file name. The
  assertions of `tests/validators.test.ts` are unchanged; only its imports and the `vld.` prefix.
