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
- **Delivered:** 2026-10-09. `tests/utils/e2e/wire-utils.ts` holds `WIRE_PREFIX`, `wire`, `closeWire`, `disconnectWire`, `ok`, `failed`, `settle` and `flush`; the twelve helper copies and three local copies in test files are gone, and the importers use the new module. Also moved: the two copies of `failed`, and the `autoipc:${channel}` literals of three helpers now call `wire`. `settle` is 20 ms everywhere (the serializer runtime helper had 10). 3294 tests, unchanged, no assertion changed.
