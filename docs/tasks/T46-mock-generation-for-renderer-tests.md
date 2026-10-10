# T46: Mock generation for renderer tests

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** renderer unit tests, Storybook and running the UI in a plain browser need a fake
  `window.ipc`.
- **Decisions (from the architect review):**
  - Config key `mock: boolean`, default `false`. When `true`, write `<ipcDataDir>/mock.ts`, for the
    default scope only (scoped surfaces are a follow-up if asked for).
  - The mock has no runtime dependency (no `vi.fn`); stubs are hand-rolled in the generated code.
  - Port channels are not mocked: their methods throw `Error("ports are not mocked")`.
- **Scope:**
  - Generated `mock.ts` imports `IpcApi` from `./types` (T44) and exports:
    ```ts
    export interface Stub<F extends (...a: any[]) => any> {
       (...args: Parameters<F>): ReturnType<F>;
       calls: Parameters<F>[];
       impl(fn: F): void;   // replace the implementation
       reset(): void;       // clear calls and the implementation
    }
    export function createIpcMock(overrides?: DeepPartial<IpcApi>): IpcMock;
    export function installIpcMock(mock?: IpcMock, target?: object): () => void;
    ```
    - Every `invoke`/`send`/`stream` method is a `Stub`. Defaults: `invoke` →
      `Promise.resolve(undefined)`, `send` → `undefined`, `stream` → an empty `AsyncIterable`.
    - `on`/`once` for `emit` channels keep listener sets and return disposers, with the same
      semantics as the real bindings (`once` removes itself; see T14).
    - `mock.emit.<name>(...args)` calls the listeners of every `emit` channel.
    - `mock.ask.<name>(...args)` calls the page's `handle` responder of an `ask` channel and
      returns its result as a promise; no responder → rejects.
    - `overrides` replace implementations (methods) or values.
    - `installIpcMock` assigns the mock to `target[exposeAs]` (default `globalThis`) and returns
      an uninstall function that restores the previous value. With `isolatedWorldId` set, the
      exposed name is the same; the mock is installed on the given target as usual.
  - Writer `src/writer/renderer/mock-writer.ts` (split per channel kind if it nears 250 lines),
    registered as one entry in the output list (T139); `mockFilePath` in `OutputPaths`,
    `IPCResolvedConfig`, `assertOutputsDistinct` and the mock config in
    `tests/utils/automation-utils.ts`; the config key in the validator, defaults, `AutoIpcConfig`.
  - Add `mock.ts` to the typecheck list (`tests/utils/e2e/typecheck-project.ts`) for fixtures with
    `mock: true`.
- **Tests:** writer text tests; a runtime test that transpiles and imports the generated `mock.ts`
  for a fixture covering every channel kind (add a new helper under `tests/utils/e2e/`;
  `runtime-utils.ts` is near the size limit) and checks calls, `impl`, defaults, `emit`, `ask`,
  `once`, disposers, `installIpcMock`/uninstall; an e2e type check including a consumer file that
  uses the mock with typed arguments and a `// @ts-expect-error` on a wrong argument type.
- **README:** a "Mocking in renderer tests" section.
- **Follow-up IDs:** T166-T167.
- **Delivered:** 2026-10-10. The config `mock` (default `false`) makes `ipcgen` write `<ipcDataDir>/mock.ts`, for the surface of no scope, through `MockWriter` (`src/writer/renderer/mock-writer.ts`; the fixed runtime text is in `mock-runtime.ts`). `mockFilePath` is in `OutputPaths`, `IPCResolvedConfig`, `assertOutputsDistinct` and the stale-file candidates, so turning `mock` off removes a generated `mock.ts` and leaves one written by hand. The file imports only `IpcApi` from `./types`, exports `Stub`, `DeepPartial`, `IpcMock`, `createIpcMock` and `installIpcMock`, and writes out only the helpers that the channels use (stubs, empty stream, listeners, responders, the throwing port methods). `IpcMock` has the members of the API (a `Stub` for each `invoke`/`send`/`stream`, also those to a utility process) plus `emit` and `ask`, so a channel cannot be named `emit` or `ask` while `mock` is on (checked in `validateReservedApiNames`, like `getPathForFile`). `getPathForFile`, when on, is a `Stub` returning `""`. `createIpcMock` throws for an override that names a member the API does not have. Listener semantics follow the preload script (order, `once` removed before it runs, disposers idempotent, a throwing listener is logged); `ask` rejects with `IpcAskError` / `IPC_ASK_NO_HANDLER` without a responder. `installIpcMock` uses the `exposeAs` name, `defineProperty` on the target, and the uninstall function restores the previous descriptor once. Tests: `mock-writer.test.ts`, the fixture `mock` with `automation/mock.test.ts` (type check with a consumer file and `@ts-expect-error` lines, scopes, stale files) and `runtime/mock.test.ts` (loads the generated file through `tests/utils/e2e/mock-utils.ts`); `extraGeneratedFiles` of the type-check has `mock.ts`. README: "Mocking in renderer tests". No follow-up task was needed, so T166-T167 stay free; mocks of scoped surfaces are not done.
