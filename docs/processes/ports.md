# Port channels

Two verbs open a `MessagePort`, so that traffic does not pass through `ipcMain` for every message. `port` pairs two windows, and `mainPort` pairs the main process with a window. This is the choice for high-frequency data, such as log tailing, audio meters or progress.

| Verb | Connects | Main process API |
|------|----------|------------------|
| `port` | two windows | `connect(winA, winB)` returns `{ close }` |
| `mainPort` | the main process and a window, a view or contents | `connect(target)` returns a connection with `send`, `on`, `onReady`, `onClose`, `onOverflow` and `close` |

Both verbs share these rules:

- The signature types the messages in both directions, and must return `void` or `Promise<void>`. A channel with another return type is rejected with `Channel return type '<type>' not allowed when channel kind is 'Port'`.
- The options are `maxQueue` (see [Bounded send queues](send-queues.md)) and `scopes`, which decides which windows get the channel in their API (see [Scopes](../security/scopes.md)). `connect` itself does not look at scopes. There are no `allowedOrigins` or `validate` options, since the main process decides who is connected.
- A channel is either a `port` channel or a `mainPort` channel, not both.
- A message is an argument list. The callbacks get the arguments, not an Electron event, and a message that is not an argument list is ignored.

## port

A `port` channel connects two windows with a `MessagePort` pair, so they talk without the main process in between. The main process pairs them with `connect`, and the pages send and listen. The signature types the messages in both directions:

<!-- readme-example: kind-port src/autoipc/schema.ts -->
```ts
import { defineChannels, port } from "automate-electron-ipc";

export default defineChannels({
   chat: port<(msg: string) => void>(),
});
```

In the main process, `connect(winA, winB)` pairs the windows. It returns a handle with `close()`:

<!-- readme-example: kind-port src/main/index.ts -->
```ts
import { app, BrowserWindow } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   const winA = new BrowserWindow();
   const winB = new BrowserWindow();
   const connection = ipc.chat.connect(winA, winB);
   // Later, to end the connection: connection.close();

   // A hub that talks to several peers gets one connection per pair:
   const hub = new BrowserWindow();
   for (const peer of [new BrowserWindow(), new BrowserWindow()]) {
      ipc.chat.connect(hub, peer);
   }
});
```

In each page, the channel has `send`, `on`, `onReady`, `onClose`, `onOverflow` and `onConnection`:

<!-- readme-example: kind-port src/renderer/app.ts -->
```ts
const stopChat = ipc.chat.on((msg) => console.log(msg)); // any number of subscribers, each with a disposer
ipc.chat.send("hi"); // queued until the port has arrived, then sent in order
ipc.chat.onReady(() => console.log("connected")); // for every new port, at once if one is there
ipc.chat.onClose(() => console.log("the connection ended"));
```

- `send` queues the messages until a port has arrived, and then sends them in order. The queue is bounded: see [Bounded send queues](send-queues.md).
- `on` and the other subscriptions take any number of callbacks, and each registration returns a function which removes it. A callback that throws is reported to `console.error` and does not stop the others.
- `onReady` runs for every new port, and at once if one is there already. The queued messages are sent before the `onReady` callbacks run, so what a callback sends comes after them.
- `onClose` runs when the connection ends (see below).

### Connecting and closing

`connect` can be called before the windows have loaded. It pairs them as soon as both pages have loaded (see [When a port is posted](#when-a-port-is-posted)), and again after either of them reloads, so a reloaded page gets a fresh port and the other page switches to it. `onReady` runs again for the new port. `onClose` does not run for a port that a new port replaces, since the connection goes on.

The handle that `connect` returns has a `close()`. It ends the connection and runs `onClose` in both windows. Closing either window ends it as well, for the other window. After the end, `send` queues again until a new `connect` pairs the windows. Passing the same window twice makes a connection of the page with itself.

`connect` needs windows that still exist. For one that is already destroyed, it throws Electron's own `TypeError: Object has been destroyed` before it registers anything, so the other window is not affected.

### Several connections

A window can hold any number of connections of a channel, such as a hub with several peers. Call `connect` once per pair (the loop in the main process above), and the hub gets each peer as a connection object of its own:

<!-- readme-example: kind-port src/renderer/hub.ts -->
```ts
const stopConnections = ipc.chat.onConnection((peer) => {
   peer.send("welcome"); // to this peer alone
   peer.on((msg) => console.log(msg)); // from this peer alone
   peer.onClose(() => console.log("a peer left"));
   // peer.close() ends the connection for the peer as well
});
```

A connection has `send`, `on`, `onReady`, `onClose`, `onOverflow` and `close`, and they address that peer alone. `onConnection` runs at once for the connections that are already there, then for each new peer, and returns a function which removes it.

A peer that reloads is the same connection object with a new port, and `onReady` runs again. `close()` ends the connection for both pages, through the main process, so it does not come back when a page reloads. `send` of a closed connection does nothing.

The methods of the channel itself, `ipc.chat.send`, `on`, `onReady`, `onClose` and `onOverflow`, address all of the connections: `send` goes to each of them (and is queued for the first one while there is none), and the other methods hear every connection. They are what a page with a single peer needs.

`onOverflow`, on the channel and on a connection, decides what happens when a send queue is full (see [Bounded send queues](send-queues.md)).

### What the generator writes

The main process has only `connect`. The preload script creates the port channel of the page, and transfers the ports that the main process sends:

```ts
// main.ts
chat: {
   connect: (winA: BrowserWindow, winB: BrowserWindow) => connectPorts('autoipc:chat', winA, winB),
},
```

```ts
// preload.ts
ports['chat'] = createPortChannel('chat', 'autoipc:chat', 1000);
ipcRenderer.on('autoipc:chat', (event: IpcRendererEvent, key: unknown) => {
   ports['chat'].pair(key, event.ports[0]);
});
ipcRenderer.on('autoipc:chat:close', (_event: IpcRendererEvent, key: unknown) => {
   ports['chat'].end(key);
});
// ...
export const api = {
   chat: ports['chat'].api,
};
```

The number in `createPortChannel` is the `maxQueue` of the channel. A page ends a connection through `autoipc:chat:disconnect`, which the main process honours only from the contents that hold that end of the connection.

## mainPort

A `mainPort` channel pairs the main process with a window. Electron recommends a `MessagePortMain` for high-frequency data, and this verb generates one. The signature types the messages in both directions, as it does for `port`:

<!-- readme-example: kind-main-port src/autoipc/schema.ts -->
```ts
import { defineChannels, mainPort } from "automate-electron-ipc";

export default defineChannels({
   logTail: mainPort<(line: string) => void>(),
});
```

In the main process, `connect` takes a window, a view or contents and returns the connection:

<!-- readme-example: kind-main-port src/main/index.ts -->
```ts
import { app, BrowserWindow } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   const mainWindow = new BrowserWindow();
   const tail = ipc.logTail.connect(mainWindow);
   tail.send("started"); // queued until the page has the port, then sent in order
   const stop = tail.on((line) => console.log("from the page:", line)); // any number of subscribers
   tail.onReady(() => console.log("the page is connected")); // for every new port, at once if one is there
   tail.onClose(() => console.log("the page is gone"));
   // Later, to end the connection for good: tail.close();
});
```

The page has the API of a `port` channel, with the main process as the peer:

<!-- readme-example: kind-main-port src/renderer/app.ts -->
```ts
ipc.logTail.on((line) => document.body.append(line));
ipc.logTail.send("hello"); // to the main process
```

The preload script is that of a `port` channel (see above). The main process gets the typed connection from `connect`:

```ts
// main.ts
logTail: {
   connect: (target: BrowserWindow | WebContents | WebContentsView): { send: (line: string) => void; on: (callback: (line: string) => void) => () => void; /* onReady, onClose, onOverflow */ close: () => void } => connectMainPort('autoipc:logTail', 'logTail', 1000, target),
},
```

`connect(target)` returns the connection of the main process, a typed wrapper of the `MessagePortMain` that it keeps. It has `send`, `on`, `onReady`, `onClose`, `onOverflow` and `close`, and works like a connection of a `port` channel in a page:

- `on`, `onReady`, `onClose` and `onOverflow` each return a function which removes that registration. A subscriber that throws is reported to `console.error` and does not stop the others.
- The connection keeps one end of a `MessageChannelMain` and transfers the other to the page once it has loaded, and again after every reload. A reloaded page gets a fresh port, `onReady` runs again, and `onClose` does not run for the replaced port.
- `onClose` runs when the port closes, such as when the page goes away. The connection then queues `send` until the page is back.
- `close()` is final. It tells the page, which runs its own `onClose`, and the connection is not paired again. A page can end the connection too, by calling `close()` on its connection.
- The connection also ends when the contents are destroyed. `send` of a closed connection does nothing.
- `onOverflow` and `configurePorts` decide what happens when the send queue is full (see [Bounded send queues](send-queues.md)).

Several `connect` calls make several connections, for one or for different contents, and a page gets each of them from `onConnection`. For contents that are already destroyed, `connect` throws `TypeError: Object has been destroyed`, before it registers anything.

## Serializers

With a [serializer](../schema/custom-serializers.md), the messages of both verbs travel as a list of one value, the list of the arguments as the serializer made it.

- A `send` that cannot be serialized throws an `IpcSerializationError` while a port is there.
- A message that waits in a queue is serialized when the queue is flushed. If that fails, it is logged with `console.error` and dropped.
- A message that cannot be deserialized is logged and dropped.

## When a port is posted

`connect` of both verbs is given a window or, for `mainPort`, a view or contents. A port that is posted before the preload script listens for it would be lost, so the main process waits until the page has loaded. A page counts as loaded:

- from every `did-finish-load`, and
- from the `did-stop-loading` of a load that finished before the connection began.

A few cases are treated specially:

- The error page that Electron shows for a failed load does not count, and the queue is kept for the next page.
- A navigation that does not commit changes nothing, so the ports of the current page stay.
- After a `stop()` that aborts a load once its document has committed, the document counts as loaded.

Every load pairs again, which is how a reloaded page gets a fresh port. A target that is destroyed later ends the connection, as described above. A page needs the generated preload script for the port to arrive.
