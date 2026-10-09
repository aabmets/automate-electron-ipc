# T135: Shared fakes for utility processes and service workers in the e2e tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `createChild` and `createParentPort` are copied in three helpers
  (utility-port, utility-process, utility-timeout). `createWorker` and `createSession` are in both
  `service-worker-utils.ts` and `service-worker-guard-utils.ts`, and the guard copy is less
  faithful: its `invoke` does not throw for a channel without a handler, and it allows a second
  `handle` for one channel, which Electron rejects.
- **Scope:** One factory of each in a shared module; the guard tests use the faithful fake. A test
  that only passed because of the unfaithful fake is a finding: record it as a new task with
  `it.fails`, as `CLAUDE.md` says, rather than changing the generated code here.
- **Tests:** Same test count; the whole suite passes.
- **Delivered:** 2026-10-09. `tests/utils/e2e/fake-utility.ts` has the one `createChild` (`child`, `posted(tag, channel?)`, `emitFromChild`, `reply`) and `createParentPort` (`port`, `posted`, `emitFromMain(data, ports?)`, `reply`, `broker`), plus `setAttachChild` and `resetUtilityProcessFakes`, which the three utility helpers had each. The guard tests use the faithful `createWorker` of `service-worker-utils.ts`, and its `createSession(...workers)` takes the workers that run already; the less faithful copies are gone. The call sites changed with the signatures (`posted("call", channel)`, `const { child } = createChild()`). The `message` event of the fake parent port carries `{ data, ports }`, as Electron's does. No guard test depended on the unfaithful fake (no new task). 3311 tests (7 new, for the fakes), no assertion changed.
