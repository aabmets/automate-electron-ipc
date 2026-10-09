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
- **Delivered:**
