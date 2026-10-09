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
- **Delivered:**
