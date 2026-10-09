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
- **Delivered:**
