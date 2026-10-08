# T46: Mock generation for renderer tests

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** renderer unit tests, Storybook and running the UI in a plain browser need a fake
  `window.ipc`.
- **Scope:**
  - Optional generated `mock.ts` exporting `createIpcMock(overrides?)`, a fully typed implementation
    whose functions are configurable stubs.
  - It can emit events to listeners: `mock.emit.progress(...)`.
  - Add `installIpcMock()` that assigns it to `window`.
- **Tests:** runtime tests of the generated mock, plus an e2e type-check.
- **Delivered:**
