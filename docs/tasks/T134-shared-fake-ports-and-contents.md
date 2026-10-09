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
- **Delivered:** 2026-10-09. `tests/utils/e2e/fake-contents.ts` has `createContents(options)` (`id`, `loading`, `url`, `destroyed`, `crashed`) and `FakeContents`; `tests/utils/e2e/fake-ports.ts` has `FakePortMain`, `FakeChannelMain`, `channelsMade`, `lastPort` and `FakePagePort`. The copies are gone (eight `createContents`, three `FakePortMain`, four `FakeChannelMain`, four `FakePagePort`, and `FakeBrokerPort`, which `FakePortMain` now covers with `fromPage` and `posted`); the call sites of `createContents` use the options object. Checked against the Electron docs: both ports of a `MessageChannelMain` are `MessagePortMain`s now (the utility fake had plain objects), and `send` / `postMessage` of destroyed contents throw "Object has been destroyed", as Electron does (the copies did not, except the one of the sender tests); no test relied on the old behavior. `createContents` of the contents handler tests wraps the shared one with an `ipc`. 3304 tests (6 new, for the fakes), no assertion changed.
