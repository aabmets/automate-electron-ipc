# T138: Fixed sleeps, weak assertions and needless exports in the tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Fixed waits that the `vitest-conventions` skill rules out:
  `test_e2e/streams/streams.main.cancel.test.ts` (30 ms) and
  `test_e2e/runtime/runtime.main.arguments*.test.ts` (5 ms). Assertions that pass without the
  code under test: `toBeDefined` in `test_e2e/automation/ipcAutomation.collisions.test.ts`,
  `test_electron/harness.group.test.ts` and `test_electron/channels/asks.answers.test.ts`. In the
  real-Electron scenarios, 64 `ctx.sleep` calls need a review: the ones that wait for something to
  happen should be `ctx.waitFor`. 14 helper exports have no importer (`createFakeIpc`, `FakeIpc`,
  `KILL_GRACE_MS`, `ElectronSupport`, `SupportProbe`, `GROUP_HOOK_TIMEOUT_MS`,
  `ScenarioContext`, `OpenOptions`, `ScenarioResult`, `ElectronRun`, `RunOptions`,
  `WIRE_PREFIX`, `Validate`, `Check`).
- **Scope:** Wait on the event or `settlePorts` instead of the fixed sleeps; assert the produced
  values; drop the needless `export` keywords that survive T132 to T135.
- **Tests:** Each strengthened assertion is shown to fail when the code it covers is broken.
- **Delivered:**
