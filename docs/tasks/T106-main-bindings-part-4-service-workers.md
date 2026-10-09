# T106: Split `main-bindings.ts`, part 4: service workers, and the final shape

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/writer/main-bindings.ts` is one class, `MainBindingsWriter`, of 3444 lines: the
  largest file by far, and the one that every feature task has grown. Four tasks (T103 to T106)
  split it, each leaving the output byte-identical. Line numbers below are those of the file when
  T102 was delivered.
- **Scope:**
  - Move the service worker section (`usesWorkerEnvelope` to `buildWorkerChannel`, lines ~2673 to
    3444, about 770 lines: helpers, sender check, timer, config, call and send lines, routing,
    senders).
  - `MainBindingsWriter` ends as a thin orchestrator of at most 280 lines, and
    `src/writer/main-bindings.ts` leaves the baseline.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:** 2026-10-09. The service worker section went to four modules, each under 280
  lines: `main-workers.ts` (API side, `WORKER_RESERVED_NAMES`), `main-worker-helpers.ts` (hubs,
  config, tables, sender check), `main-worker-calls.ts` (calls, sends, timer) and
  `main-worker-routing.ts` (routes, plus `buildWorkerAskLines`). That last builder is the
  `askServiceWorker` block of `buildWorkerHelpers`, pulled out verbatim so the helpers fit. Getting
  the writer under the limit took two more moves. The reserved-name list became
  `getMainReservedNames(uses)` in `main-reserved-names.ts`. `OffPageUse` and
  `buildOffPageChannels` went to `main-off-page.ts`, and `isUtilitySpec` and `isBrokeredSpec`
  joined `MainContext` for them. `SupportBuilders` is gone, and `getValidatedWorkerEvents` imports
  `getWorkerEventType` directly. `main-bindings.ts` is 274 lines and left the baseline, and the
  output of all 95 fixtures is byte-identical.
