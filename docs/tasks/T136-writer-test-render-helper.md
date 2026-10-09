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
- **Delivered:**
