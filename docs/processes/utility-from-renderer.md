# Calling a utility process from a renderer

A page can call a utility process directly, over a port that the main process brokers.

A page that needs the database of a utility process would otherwise hop through the main process for
every query. `invokeUtility` and `streamUtility` let the page talk to the child directly: the main
process only brokers a `MessageChannelMain` between a window and the child, and sees none of the
traffic afterwards.

<!-- readme-example: kind-utility-page src/autoipc/schema.ts -->
```ts
import { defineChannels, invokeUtility, streamUtility } from "automate-electron-ipc";

export interface Row {
   id: number;
   title: string;
}

export default defineChannels({
   queryRows: invokeUtility<(sql: string) => Promise<Row[]>>(),
   scanRows: streamUtility<(table: string) => AsyncIterable<Row>>(),
});
```

The main process forks the child and connects it to the window. The connection takes a window, a view
or contents:

<!-- readme-example: kind-utility-page src/main/index.ts -->
```ts
import path from "node:path";
import { BrowserWindow } from "electron";
import { forkUtility, ipc } from "../autoipc/main";

export function openWindow(preload: string): void {
   const child = forkUtility(path.join(__dirname, "indexer.js")); // or attachUtility(child) right after fork
   const win = new BrowserWindow({ webPreferences: { preload } });
   const link = ipc.queryRows.connect(child, win);
   ipc.scanRows.connect(child, win);
   // Later, to end the connection: link.close()
   console.log(link);
}
```

The child registers the handlers when it starts:

<!-- readme-example: kind-utility-page src/utility/indexer.ts -->
```ts
import { ipc } from "../autoipc/utility";

const db = {
   all: async (_sql: string) => [{ id: 1, title: "first" }],
   iterate: (_table: string) => [{ id: 1, title: "first" }],
};

ipc.queryRows.handle(async (sql) => db.all(sql));
ipc.scanRows.handle(async function* (table) {
   for (const row of db.iterate(table)) {
      yield row;
   }
});
```

The page calls them like an `invoke` and a `stream` channel:

<!-- readme-example: kind-utility-page src/renderer/app.ts -->
```ts
async function showRows(): Promise<void> {
   const rows = await ipc.queryRows.invoke("select * from notes");
   console.log(rows.length);
   for await (const row of ipc.scanRows.stream("notes")) {
      document.body.append(row.title);
   }
}

showRows();
```

The main process only connects. The preload script gives the page a client for each channel:

```ts
// main.ts
queryRows: {
   connect: (child: UtilityProcess, target: BrowserWindow | WebContents | WebContentsView): { close: () => void } => connectUtilityPort('autoipc:queryRows', child, target),
},
```

```ts
// preload.ts
queryRows: {
   invoke: (...args: any[]) => callUtilityPort(utilityClients['queryRows'], args),
},
scanRows: {
   stream: (...args: any[]) => openUtilityStream(utilityClients['scanRows'], args, 1024),
},
```

The page API is that of [`invoke`](../channels/invoke.md) and [`stream`](../channels/stream.md), and the types of `types.ts` declare the errors: the
optional second type argument of the verbs lists the error types of the handler, like it does for
`invoke`. A failure reaches the page as a plain object `{ name, message, code?, data? }`. The library
adds an `IpcUtilityError` with these codes:

| Code                       | Meaning                                                                       |
|----------------------------|-------------------------------------------------------------------------------|
| `IPC_UTILITY_EXITED`       | the connection closed (the child exited, `close()` was called, or the port was replaced), also while the call or the stream was open, and any later call |
| `IPC_UTILITY_NO_HANDLER`   | the child has no handler of this kind for the channel                         |
| `IPC_UTILITY_NOT_ITERABLE` | the handler of a stream returned something that is not an async iterable      |
| `IPC_UTILITY_UNSENDABLE`   | the arguments, the result or a chunk cannot be cloned                         |
| `IPC_UTILITY_INVALID_REPLY`| the reply had an unknown shape                                                |
| `IPC_UTILITY_TIMEOUT`      | no reply (or, for a stream, no first chunk, end or error) arrived within `timeoutMs` |

A few things to know:
 - There is one port per channel and page, and `connect(child, target)` is how the main process
   chooses the child that serves a channel, and the pages that may use it. A page cannot reach a
   channel that was not connected to it, and a port serves only the channel it was made for.
   Connecting the same channel to the same page again replaces the earlier connection.
 - The port is posted once the page has loaded (see [When a port is posted](ports.md#when-a-port-is-posted)),
   and again on every load, so a page that reloads gets a fresh port. A call made before the port is
   there waits for it, in order. The connection ends when
   `close()` is called, when the child exits and when the contents are destroyed. After that, calls
   are rejected with `IPC_UTILITY_EXITED` until the main process connects again, such as to a new child.
 - `connect(child, target)` needs a child that `forkUtility` or `attachUtility` knows, like the other
   channels. It throws `IPC_UTILITY_NOT_ATTACHED` for one that they never saw, and `IPC_UTILITY_EXITED` for
   one that exited, since a page connected to either would wait for a port which never comes. The earlier
   connection of the page stays as it was. A schema with only such channels gets `forkUtility`,
   `attachUtility` and `IpcUtilityError` in `main.ts` as well.
 - All the calls and streams of a channel share its port and are told apart by an ID. Cancelling a
   stream (`cancel()`, `return()` or a `break`) and closing the connection stop the generator in the
   child. The generator is slowed down for a page that reads slowly, with `highWaterMark` as for
   `stream` (the default is 1024 chunks, per call).
 - The handler of the child is single, as for `callUtility`: a new `handle` replaces the old one, and
   the function it returns removes only its own. Register the handlers when the process starts, since a
   call for a channel without a handler is answered with `IPC_UTILITY_NO_HANDLER`.
 - `invokeUtility` and `streamUtility` take `timeoutMs` and `scopes` (and `streamUtility` also
   `highWaterMark`, above). `timeoutMs` is described under [Timeouts](../channels/invoke.md#timeouts): the default of the
   config applies to `invokeUtility` but not to `streamUtility`, and a call without a limit, whose
   handler never answers, waits until the connection closes. The timer starts when the page makes
   the call, so it covers the wait for the port as well. On a timeout the handler in the child is not
   stopped and its late reply is dropped, but a stream is cancelled in the child. A stream is
   timed only until its first chunk, its end or its error: one that has begun is not cut short, since
   a slow reader holds the generator back on purpose. `scopes` decides which windows have the
   channel in their API (see [Scopes](../security/scopes.md)). There are no `allowedOrigins` or `validate` options: the main process decides
   which pages are connected, and a port serves only the channel it was made for. The child receives
   the arguments of the page as they are, so check them in the handler.

