# T136: One `render` helper for the writer tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** 43 writer tests define a local `render` that builds a `Vitest*Writer`, calls
  `write(false)` and reads the target file back. The six `Vitest*Writer` subclasses of
  `tests/utils/writer/writer-utils.ts` differ only in the base class and the optional scope.
  `service-worker-writer-utils.ts` and `utility-writer-utils.ts` have their own `render`. Channel
  literals such as `{ name: "getIt", kind: "Unicast", direction: "RendererToMain" }` are written
  out about 20 times. `writer-utils.ts` and `shared-mocks.ts` export default objects, while the
  other helpers export by name.
- **Scope:** `renderWith(WriterClass, channels, config)` and one generic test writer factory in
  `tests/utils/writer/`, shared channel constants, named exports. Replace the local `render`s.
- **Tests:** Same test count, no assertion changed.
- **Delivered:** 2026-10-09. `tests/utils/writer/render-utils.ts` has `renderWith(Writer, channels, config, scope)` and `renderSpecs` (for specs that are built already); `test-writers.ts` has `createTestWriter(Writer)`, which replaces the six hand-written subclasses (`VitestMainBindingsWriter` and the others are made with it, and `VitestBaseWriter` moved there). The 38 local `render`s with a body and the 32 inline write-and-read sequences call them, and what stays of a local `render` is a one-line arrow that fixes the writer and the config. `getIt`, `sendIt` and `getUser` in `writer-utils.ts` replace the channel literals and the `renderer` of the utility and worker helpers. `writer-utils.ts` and `shared-mocks.ts` export by name, so all 48 importers use named imports; `shared.SimpleChannel` was not a type before (the namespace did not exist), so `SimpleChannel` takes `readonly` arrays now. `mockGetTargetFilePath` takes any class with a `prototype`. 3315 tests (4 new, for the helpers), no assertion changed.
