# Rewriting the schema

The schema and the generated API both changed in 1.0. This page shows how a 0.2 schema looks in 1.0, and how the
names of the generated API map from the old ones to the new ones.

## Rewriting the schema

Each `Channel(...)` statement becomes a property of one exported channel map. The name is the key, the verb
replaces the direction and the kind, and the signature is a type argument:

```typescript
// 0.2
import { Channel, type } from "automate-electron-ipc";

Channel("GetUser").RendererToMain.Unicast({
   signature: type as (id: number) => Promise<User>,
});
Channel("EchoUserName").RendererToMain.Broadcast({
   signature: type as (userName: string) => void,
});
Channel("Progress").MainToRenderer.Broadcast({
   signature: type as (percent: number) => void,
   trigger: "focus",
});
Channel("Chat").RendererToRenderer.Port({
   signature: type as (message: string) => void,
});
```

<!-- readme-example: migration-schema src/autoipc/schema.ts -->
```ts
// 1.0
import { defineChannels, emit, invoke, port, send } from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   echoUserName: send<(userName: string) => void>(),
   progress: emit<(percent: number) => void>({ trigger: "focus" }),
   chat: port<(message: string) => void>(),
});
```

| 0.2 direction and kind | 1.0 verb |
|---|---|
| `RendererToMain.Unicast` | `invoke` |
| `RendererToMain.Broadcast` | `send` |
| `MainToRenderer.Broadcast` | `emit` |
| `RendererToRenderer.Port` | `port` |

- The map has to be exported: `export default defineChannels({...})` or `export const channels = defineChannels({...})`. A map that is declared first and exported later (`export default channels`, `export { channels }`) works too. A file may have only one `defineChannels` call.
- `Channel`, `type` and the config types of 0.2 (`UnicastConfig`, `BroadcastConfig`, ...) are gone from the package. The `signature` key is gone with them, and so is `listeners`: to have several subscribers, call `.on()` more than once.
- The `trigger` option stays on `emit` channels, and its list of events grew by `persisted-state-restored` and `query-session-end`. The event is checked now: a name that is not a `BrowserWindow` event is an error, where 0.2 accepted any string.
- A channel name can be any identifier now. 0.2 wanted a name of at least three characters that began with a capital letter and not with `on`. The key is the name of the member of the generated API, so a key of `getUser` gives `ipc.getUser`. A name that `Object.prototype` has (`constructor`, `toString`, ...) is refused.
- Only the types that a channel uses have to be exported from the schema file. 0.2 required every interface and type alias of the file to be exported.
- A type that the schema imports can be a class or an enum from a plain `import`; 0.2 knew only the types of `import type`.
- A `schema` directory is read for `.ts`, `.mts` and `.cts` files (not `.d.ts`). 0.2 parsed every file in it.
- A signature that structured clone cannot send, such as one with a function in a parameter, was listed as unsupported in the types of 0.2 but not checked. It is an error now, see [What can be sent](../schema/what-can-be-sent.md).
- The `as` form, `invoke({ ... }) as (id: number) => Promise<User>`, is also allowed, see [The `as` form](../schema/as-form.md).

The channels that 1.0 adds (`ask`, `stream`, `mainPort` and the verbs for utility processes and service workers)
have no 0.2 counterpart, see [Verbs](../schema/verbs.md).

## Generated names

The names of the generated API changed, and the main process object is no longer called `ipcMain`. The 0.2 names
are those of the channels above, which began with a capital letter:

| 0.2                                       | 1.0                                  |
|-------------------------------------------|--------------------------------------|
| `import { ipcMain } from "./main"`        | `import { ipc } from "./main"`       |
| `ipcMain.onGetUser(cb)` (`invoke`)        | `ipc.getUser.handle(cb)`             |
| `ipcMain.onEchoUserName(cb)` (`send`)     | `ipc.echoUserName.on(cb)`            |
| `ipcMain.sendProgress(win, n)`            | `ipc.progress.send(win, n)`          |
| `ipcMain.sendProgress(win, n)` of a channel with a `trigger` | `ipc.progress.bind(win, () => [n])` |
| `ipcMain.ports.Chat.propagate(winA, winB)`| `ipc.chat.connect(winA, winB)`       |
| `window.ipc.sendGetUser(id)` (`invoke`)   | `ipc.getUser.invoke(id)`             |
| `window.ipc.sendEchoUserName(name)` (`send`) | `ipc.echoUserName.send(name)`     |
| `window.ipc.onProgress(cb)`               | `ipc.progress.on(cb)`                |
| `window.ipc.ports.Chat.sendMessage(...)`  | `ipc.chat.send(...)`                 |
| `window.ipc.ports.Chat.onMessage(cb)`     | `ipc.chat.on(cb)`                    |
| `interface Window { ipc: {...} }` and `export default Window` in `window.d.ts` | `declare global { var ipc: IpcApi }` |

`window.ipc` keeps working, since `ipc` is a global variable.

With a `trigger`, the `sendProgress(win, n)` of 0.2 did not send. It registered a listener on the window that sent
`n` each time the event fired. That job is now `bind(win, provider)`, where `provider` returns the arguments at the
time of the event, as `[n]`. The `send(win, n)` of 1.0 sends at once, with or without a `trigger`, see
[emit](../channels/emit.md#triggers-and-bind).

### Registrations return a cleanup function

The registrations return something now. `window.ipc.onProgress(cb)` of 0.2 gave back Electron's `ipcRenderer`, and `ipc.progress.on(cb)` gives back a function which removes that listener. In the main process too, `on` and `handle` return a function that removes the registration, and `handle` replaces the handler of the channel when it is called again, where `ipcMain.handle` throws.

```typescript
// 0.2: nothing to unsubscribe with
useEffect(() => {
   window.ipc.onProgress((percent) => setPercent(percent));
}, []);
```

```typescript
// 1.0: the return value is the cleanup function
useEffect(() => ipc.progress.on((percent) => setPercent(percent)), []);
```
