# Renderer

Besides the typed `window.ipc` of the page, `ipcgen` can write code that helps the renderer side of an app: types for code that wraps the API, hooks for React and Vue, and a fake of the API for tests. This section covers those three.

| Page | Covers | Written |
|------|--------|---------|
| [Helper types](helper-types.md) | `types.ts`: `IpcApi`, `ChannelName`, `ChannelArgs<N>`, `ChannelReturn<N>` and the error and stream types | Always |
| [Framework hooks](framework-hooks.md) | `hooks.react.ts` or `hooks.vue.ts`: `useIpcEvent` and `useIpcInvoke` | With `"hooks": "react"` or `"hooks": "vue"` |
| [Mocking in renderer tests](mocking.md) | `mock.ts`: a fake of `window.ipc` for unit tests, Storybook and a plain browser | With `"mock": true` |

Set `hooks` and `mock` in the [configuration](../tooling/configuration.md). All three files are written to the data directory (`ipcDataDir`, `src/autoipc` by default), next to `main.ts` and `preload.ts`. They have no path option of their own.

The hooks and the mock describe the API of a window that is in no [scope](../security/scopes.md): the channels that have no `scopes` option, which is all of them in a schema that uses no scopes. Only `types.ts` is written again for each scope, as `types.<scope>.ts`.

Like the other [generated files](../tooling/generated-files.md), they are not edited by hand, and a hooks or mock file that the config no longer asks for is removed on the next run.
