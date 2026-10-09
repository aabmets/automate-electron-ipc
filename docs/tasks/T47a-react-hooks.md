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
- **Delivered:**
