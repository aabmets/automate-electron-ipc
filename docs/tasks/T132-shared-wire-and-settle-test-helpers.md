# T132: One test module for wire names, results and settling

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `wire = (name) => \`autoipc:${name}\`` is exported from eight helpers in
  `tests/utils/e2e/` (main-port, port-connect, port-queue, runtime-main, service-worker,
  stream-main, utility-port, utility-process); `closeWire` from four, `disconnectWire` from two,
  `ok = { ok: true, value }` from five, `settle = () => settlePorts(N)` from five and `flush`
  from three.
- **Scope:** One `tests/utils/e2e/wire-utils.ts` with these helpers; delete the copies and update the
  importers. Keep the Standard Schema `ok` of `runtime-validation-utils.ts`, which is another thing.
- **Tests:** Same test count, no assertion changed, the whole suite passes.
- **Delivered:**
