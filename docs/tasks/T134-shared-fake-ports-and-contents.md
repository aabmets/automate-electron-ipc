# T134: Shared fakes for ports and web contents in the e2e tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `FakePortMain` is copied in three helpers of `tests/utils/e2e/`, `FakeChannelMain`
  in four, `FakePagePort` in four (near-identical) and `createContents` in eight, each with a
  subset of the same members.
- **Scope:** One superset factory per fake, with an options object, in a new module under
  `tests/utils/e2e/`; delete the copies. Each fake must behave like the Electron object it replaces
  (see the `vitest-conventions` skill); check it against the Electron docs, not the tests.
- **Tests:** Same test count, no assertion changed, the whole suite passes.
- **Delivered:**
