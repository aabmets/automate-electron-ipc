# T47b: Vue composables (optional output)

Phase 4: Developer experience. Split from [T47](./T47-framework-hooks.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope:** `hooks: "vue"` (the key exists since T47a; remove its "not generated yet" warning)
  writes `<ipcDataDir>/hooks.vue.ts`, default scope only, with the same names and channel coverage
  as T47a:
  - `useIpcEvent(name, callback)` subscribes immediately and disposes in `onScopeDispose`.
  - `useIpcInvoke(name)` returns `{ invoke, data: ShallowRef, error: ShallowRef, pending: Ref<boolean> }`
    with the same stale-result guard as T47a.
  - Reuse T47a's type aliases; move them to a shared emitter if both writers need them.
  - Writer `src/writer/renderer/hooks-vue.ts`; the output path follows `hooks` (one
    `hooksFilePath`, two file names).
  - Dev dependency `vue`, exact version, `bun.lock` updated.
- **Tests:** writer text tests; an e2e type check with a consumer file; a runtime test with a fake
  `onScopeDispose`/`shallowRef`/`ref` covering subscribe, dispose, and the stale-result guard.
- **README:** extend "Framework hooks" with Vue.
- **Follow-up IDs:** T170-T171.
- **Delivered:** 2026-10-10. `hooks: "vue"` writes `<ipcDataDir>/hooks.vue.ts` from `VueHooksWriter` (`src/writer/renderer/hooks-vue.ts`), one entry in the output list of `collectWriters`, for the surface of no scope; the warning `logger.vueHooksNotGenerated` is gone. The type aliases (`EventName`, `EventCallback<N>`, `InvokeName`, `InvokeArgs<N>`, `InvokeReturn<N>`), the `api()` accessor, the types import and the indent handling moved to the shared `FrameworkHooksWriter` (`src/writer/renderer/hooks-base.ts`), which `ReactHooksWriter` extends too, so the output of `hooks.react.ts` is unchanged. `hooksFilePath` and the stale-file removal needed no change (T47a already derives `hooks.vue.ts` and lists both names). The file imports `onScopeDispose`, `ref`, `shallowRef` and the types `Ref` and `ShallowRef` from `vue`. `useIpcEvent` subscribes at once and passes the unsubscribe function to `onScopeDispose`. `useIpcInvoke` returns `invoke`, `data` and `error` (`ShallowRef`) and `pending` (`Ref<boolean>`), with the semantics of T47a: `invoke` rejects with the error as well as setting it, `error` clears when the next call starts, `data` keeps the last result after a failure, and the refs are not written by a call that finished after the scope was disposed or after a newer call started. Dev dependency `vue` 3.5.43, exact, `bun.lock` updated. Tests: the writer text tests (`hooks-vue.test.ts`), the fixture `vue-hooks` with `vueHooks.test.ts` (an e2e type check of a consumer `.ts` with `@ts-expect-error` on wrong names, kinds, arguments and ref types, and a project type check; the typecheck helper maps `vue` to its typings and finds `hooks.vue.ts` as well), `hooksFiles.test.ts` (vue writes the file and removes the react one, switching and turning off, no warnings), and `vueHooks.runtime.test.ts` with a fake Vue (`tests/utils/e2e/fake-vue.ts`: `ref`, `shallowRef`, `onScopeDispose` in a scope that the test disposes) for subscribe, dispose, the stale-result guard and disposal. README: "Framework hooks" has a "Vue" part, and the `hooks` option and the feature list name both files. No follow-up tasks were needed (T170-T171 stay free).
