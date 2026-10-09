# T119: Split the real-Electron tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_electron/`: `core.test.ts` (706),
  `utilityPorts.test.ts` (655), `ports.test.ts` (522), `serviceWorkers.test.ts` (484),
  `utility.test.ts` (452), `streams.test.ts` (413), `asks.test.ts` (340), `scopes.test.ts` (314).
  `harness.test.ts` (292) is over the soft limit.
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Mirror the layout of the matching source modules if their split has landed.
  - A scenario is a function turned into text, which can use only its `ctx` argument: moving one
    must not give it a closure over anything else. Keep the `it.fails` tests, with their task IDs.
  - Run `bun run test:electron` with the binary and a display, since a split that skips silently
    proves nothing; `REQUIRE_ELECTRON=1` makes a skip fail.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:**
