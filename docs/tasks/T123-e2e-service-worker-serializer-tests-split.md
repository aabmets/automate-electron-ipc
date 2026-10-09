# T123: Split the e2e tests, part 4: service workers, serializers and the rest

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_e2e/`: `serviceWorkers.test.ts` (1007),
  `serializer.test.ts` (716), `serviceWorkerGuards.test.ts` (638), `serializerUtility.test.ts`
  (594), `serializerWorkers.test.ts` (458), `serializerPorts.test.ts` (429), `signatures.test.ts`
  (356), `senders.test.ts` (349), `errors.test.ts` (345).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - `generatorFindings.test.ts` and other files not listed are under the limit; leave them.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `serviceWorkers`, `serializer`, `serviceWorkerGuards`, `serializerUtility`,
  `serializerWorkers`, `serializerPorts`, `signatures`, `senders` and `errors` of `tests/test_e2e` are now
  24 files of at most 272 lines (with header), split along their describe blocks, with the shared fakes
  in `tests/utils` (`service-worker-utils.ts` extended; new `service-worker-guard-utils.ts`,
  `serializer-runtime-utils.ts`, `serializer-wire-utils.ts`, `serializer-brokered-utils.ts`,
  `serializer-worker-utils.ts`, `sender-utils.ts`, `errors-main-utils.ts`). 305 tests before and after
  with identical titles, none skipped, no assertion changed. The nine baseline entries are removed, so
  `size-baseline.json` is empty.
