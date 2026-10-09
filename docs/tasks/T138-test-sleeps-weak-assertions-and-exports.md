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
- **Delivered:** 2026-10-09. The fixed waits of `streams.main.cancel` and of the two `runtime.main.arguments*` files wait on the first chunk (`vi.waitFor`) and on `flush()` now. `toBeDefined` is gone: the namespace aliases of `ipcAutomation.collisions` must be identifiers, the killed child of `harness.group` has a pid, and the no-handler ask of `asks.answers` has the code `IPC_ASK_NO_HANDLER`. Of the 64 `ctx.sleep` calls in `tests/test_electron`, 16 were waits for something to happen and are `ctx.waitFor` / `ctx.until` now (the pairing of ports after a load, connect or reload in `ports.port`, `ports.mainPort` and `ports.navigation`; the rejections in `guards` and `serviceWorkers.validation`; the question that must be in flight in `asks.goneAway`). The 48 that remain are deliberate: a window in which nothing may arrive (after a marker that proves the dropped message had time to travel, a navigation that is prevented, a paused generator), the timings under test (`timeouts`, `utility.calls`), the pace of a slow generator or handler, and the harness tests of the harness. 13 of the 14 exports are not exported any more (`WIRE_PREFIX` has an importer since T132); `FakeContentsOptions` and `createTestWriter` from T134 and T136 lost theirs too. The strengthened assertions and the replaced waits of the e2e tests were broken on purpose and went red: the `drop` flag of async sends, `iterator.return` of a stream cancel, the alias of a namespace import, the code of the no-handler reply (in Electron). The Electron suite ran with the other waits changed, twice (214 tests, as before). 3319 tests, as before.
