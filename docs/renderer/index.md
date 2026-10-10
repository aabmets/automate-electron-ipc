# Renderer

Besides the typed API on `window.ipc`, `ipcgen` can write code for the renderer side of your app: helper types for code that wraps the API generically, hooks for React and Vue, and a fake of the API for tests. The helper types are always written; hooks and the mock are written only when you turn them on in the [configuration](../tooling/configuration.md).

| Page | Covers |
|------|--------|
| [Helper types](helper-types.md) | `types.ts`: `IpcApi`, `ChannelName`, `ChannelArgs<N>` and `ChannelReturn<N>` |
| [Framework hooks](framework-hooks.md) | `hooks.react.ts` and `hooks.vue.ts`: `useIpcEvent` and `useIpcInvoke` |
| [Mocking in renderer tests](mocking.md) | `mock.ts`: a fake of `window.ipc` for unit tests, Storybook and a plain browser |
