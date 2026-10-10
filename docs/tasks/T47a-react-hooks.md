# T47a: React hooks (optional output)

Phase 4: Developer experience. Split from [T47](./T47-framework-hooks.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Decisions (from the architect review):**
  - Config key `hooks: "react" | "vue" | false`, default `false` (this task adds the key with both
    values; `"vue"` is accepted but generates nothing until T47b, with a warning saying so).
  - Output `<ipcDataDir>/hooks.react.ts`, default scope only. It reaches the API through
    `globalThis[exposeAs]` typed as `IpcApi` from `./types` (T44).
  - Events are `emit` channels; invokes are `invoke` channels. Other kinds are not covered.
- **Scope:**
  - Generated hooks:
    ```ts
    export function useIpcEvent<N extends EventName>(name: N, callback: EventCallback<N>): void;
    export function useIpcInvoke<N extends InvokeName>(name: N): {
       invoke(...args: InvokeArgs<N>): Promise<InvokeReturn<N>>;
       data: InvokeReturn<N> | undefined;
       error: unknown;
       pending: boolean;
    };
    ```
    `useIpcEvent` subscribes in `useEffect`, disposes on unmount, and keeps the latest callback in
    a ref so re-renders do not resubscribe (the effect depends on `name` only). `useIpcInvoke`
    ignores results of calls that finished after unmount or after a newer call.
    `EventName`/`InvokeName` etc. are emitted as type aliases derived from `IpcApi`.
  - The generated file imports `react` (`useEffect`, `useRef`, `useState`, `useCallback`); the
    library itself keeps no framework dependency.
  - Writer `src/writer/renderer/hooks-react.ts`, one output-list entry (T139); `hooksFilePath`
    in `OutputPaths`/`IPCResolvedConfig`/`assertOutputsDistinct`/the test config mock; the key in
    the validator, defaults, `AutoIpcConfig`.
  - Dev dependencies: `@types/react` and `react`, exact versions (no ranges), with `bun.lock`
    updated by `bun install` (CI uses `--frozen-lockfile`). `tests/packaging.test.ts` must still
    pass (they are dev-only).
- **Tests:** writer text tests; an e2e type check of the generated file plus a consumer `.tsx`
  using both hooks (with `// @ts-expect-error` on a wrong channel name and a wrong argument); a
  runtime test with a minimal fake React (`useEffect`/`useRef`/`useState` stubs that run effects
  and cleanups) covering subscribe, dispose on unmount, no resubscribe on a new callback, and the
  stale-result guard.
- **README:** a "Framework hooks" section (React).
- **Follow-up IDs:** T168-T169.
- **Delivered:** 2026-10-10. The config key `hooks` (`"react" | "vue" | false`, default `false`) is validated and typed in `AutoIpcConfig`. `hooks: "react"` writes `<ipcDataDir>/hooks.react.ts` from `ReactHooksWriter` (`src/writer/renderer/hooks-react.ts`), one entry in the output list of `collectWriters`, for the surface of no scope; `"vue"` writes nothing and logs one warning (`logger.vueHooksNotGenerated`, to be removed by T47b). `hooksFilePath` is in `OutputPaths`/`IPCResolvedConfig`, derived from `hooks` (`hooks.vue.ts` for `"vue"`, else `hooks.react.ts`, so T47b needs no second path), and `assertOutputsDistinct` refuses it as the path of another output only while `hooks` is set. `findStaleGeneratedFiles` lists both hooks file names next to `hooksFilePath`, so turning `hooks` off or changing it removes the file of the earlier run (only if it has the generated header), and `--check` lists it. The file imports `react` and `IpcApi` from `./types` (with `.js` under NodeNext), and exports `EventName` (members with `on` and `once`, which leaves out ports), `EventCallback<N>`, `InvokeName` (members with `invoke`), `InvokeArgs<N>`, `InvokeReturn<N>`, `useIpcEvent` and `useIpcInvoke`. Brokered `invoke` channels to a utility process are `invoke` members of `IpcApi`, so they are covered too. `useIpcEvent` updates a ref with the latest callback in an effect and subscribes in an effect on `[name]`. `useIpcInvoke` guards state writes with a mounted ref and a call counter; `invoke` also rejects with the error (and sets `error`), `error` clears when the next call starts, and `data` keeps the last result after a failure. Dev dependencies `react` and `@types/react` 19.3.0, exact. Tests: the writer text tests, validator and path tests, the fixture `react-hooks` with `reactHooks.test.ts` (an e2e type check of a consumer `.tsx` with `@ts-expect-error` on wrong names, kinds and arguments, and a project type check; the typecheck helper maps `react` to `@types/react`), `hooksFiles.test.ts` (off, stale removal, vue warning, `--check`), and `reactHooks.runtime.test.ts` with a fake React (`tests/utils/e2e/fake-react.ts`) for subscribe, dispose, no resubscribe, the stale-result guard and unmount. Also fixed two tests that were red on the branch before this task or broken by the new key: `format.test.ts` did not expect `types.ts` among the files that an unformatted run leaves stale (T43b met T44), and `unknownKey.test.ts` lists `hooks` among the known keys. README: "Framework hooks".
