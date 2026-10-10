# Calling a utility process from a renderer

A page can call a utility process directly, over a port that the main process brokers.

A page that needs the database of a utility process would otherwise hop through the main process for every query. `invokeUtility` and `streamUtility` let the page talk to the child directly: the main process only brokers a `MessageChannelMain` between a window and the child, and sees none of the traffic afterwards.

| Verb | Page API | Main process | Utility process |
|------|----------|--------------|-----------------|
| `invokeUtility` | `invoke(...args)` | `connect(child, target)` | `handle(callback)` |
| `streamUtility` | `stream(...args)` | `connect(child, target)` | `handle(callback)` |

The signature of `invokeUtility` may return any value, or a promise of it. The signature of `streamUtility` returns an `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>`, and its handler in the child is an `async function*`.

## An example

The schema declares the two channels:

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

The main process forks the child and connects it to the window. The connection takes a window, a view or contents, and returns `{ close }`:

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

The child registers the handlers when it starts. It is the same entry file that serves the [channels of the main process](utility-processes.md):

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

## Connections

There is one port per channel and page. `connect(child, target)` is how the main process chooses the child that serves a channel, and the pages that may use it. A page cannot reach a channel that was not connected to it, and a port serves only the channel it was made for.

- Connecting the same channel to the same page again replaces the earlier connection. Calls and streams that were open on it fail with `IPC_UTILITY_EXITED`.
- The port is posted once the page has loaded (see [When a port is posted](ports.md#when-a-port-is-posted)), and again on every load, so a page that reloads gets a fresh port.
- A call or a stream made before the port is there waits for it, in order. If the main process never connects, it waits for ever, unless the channel has a `timeoutMs`.
- The connection ends when `close()` is called, when the child exits and when the contents are destroyed. After that, calls are rejected with `IPC_UTILITY_EXITED` until the main process connects again, such as to a new child.
- `connect(child, target)` needs a child that `forkUtility` or `attachUtility` knows (see [Forking and attaching](utility-processes.md#forking-and-attaching)). It throws `IPC_UTILITY_NOT_ATTACHED` for one that they never saw, and `IPC_UTILITY_EXITED` for one that exited, since a page connected to either would wait for a port which never comes. The earlier connection of the page stays as it was.
- `connect` throws `TypeError: Object has been destroyed` for contents that are already destroyed. A failure of the first pairing is thrown to the caller, a later one (on a reload) goes to `console.error`.
- A schema with only such channels gets `forkUtility`, `attachUtility` and `IpcUtilityError` in `main.ts` as well.

## Calls and streams

The page API is that of [`invoke`](../channels/invoke.md) and [`stream`](../channels/stream.md). The types of `types.ts` declare the errors: the optional second type argument of the verbs lists the error types of the handler, like it does for `invoke`.

- All the calls and streams of a channel share its port and are told apart by an ID.
- The handler of the child is single, as for `callUtility`: a new `handle` replaces the old one, and the function it returns removes only its own. Register the handlers when the process starts, since a call for a channel without a handler is answered with `IPC_UTILITY_NO_HANDLER`.
- Cancelling a stream (`cancel()`, `return()` or a `break`) and closing the connection stop the generator in the child, which runs its `finally` blocks.
- The generator is slowed down for a page that reads slowly, with `highWaterMark` as for `stream`. The default is 1024 chunks, per call.
- The child receives the arguments of the page as they are, so check them in the handler.

## Errors

A failure reaches the page as a plain object `{ name, message, code?, data? }`, since `contextBridge` does not keep the fields of an `Error`. For the errors of the handler, these are the `name`, `message`, `code` and `data` of what it threw. The library adds an `IpcUtilityError` with these codes. `<name>` is the name of the channel:

| Code                       | Meaning                                                                       | Message |
|----------------------------|-------------------------------------------------------------------------------|---------|
| `IPC_UTILITY_EXITED`       | the connection closed (the child exited, `close()` was called, or the port was replaced), also while the call or the stream was open, and any later call | `The utility process of the channel '<name>' is gone` for a call after the end, `The connection closed before the channel '<name>' was answered` for one that was open (the text says `was closed` or `was replaced` for those causes) |
| `IPC_UTILITY_NO_HANDLER`   | the child has no handler of this kind for the channel                         | `The other side has no handler for the channel '<name>'`, and for a stream `The utility process has no stream handler for the channel '<name>'` |
| `IPC_UTILITY_NOT_ITERABLE` | the handler of a stream returned something that is not an async iterable      | `The handler of the channel '<name>' did not return an async iterable` |
| `IPC_UTILITY_UNSENDABLE`   | the arguments, the result or a chunk cannot be cloned                         | `A call of the channel '<name>' cannot be sent: <reason>`, `A chunk of the channel '<name>' cannot be sent: <reason>` |
| `IPC_UTILITY_INVALID_REPLY`| the reply had an unknown shape                                                | `The utility process sent an unreadable reply to the channel '<name>'` |
| `IPC_UTILITY_TIMEOUT`      | no reply (or, for a stream, no first chunk, end or error) arrived within `timeoutMs` | `The channel '<name>' did not answer within <ms> ms` |

With a [serializer](../schema/custom-serializers.md), arguments that cannot be serialized reject the call, or fail the stream, with `{ name: "IpcSerializationError", message, code: "IPC_SERIALIZATION" }`.

## Options and timeouts

`invokeUtility` takes `timeoutMs` and `scopes`, and `streamUtility` also `highWaterMark` (above). `scopes` decides which windows have the channel in their API (see [Scopes](../security/scopes.md)). There are no `allowedOrigins` or `validate` options: the main process decides which pages are connected, and a port serves only the channel it was made for.

`timeoutMs` is described under [Timeouts](../channels/invoke.md#timeouts). The default of the config applies to `invokeUtility` but not to `streamUtility`, and `0` turns it off for a channel.

- The timer starts when the page makes the call, so it covers the wait for the port as well.
- On a timeout of a call, the handler in the child is not stopped and its late reply is dropped.
- A stream is timed only until its first chunk, its end or its error. A timed-out stream is cancelled in the child. One that has begun is not cut short, since a slow reader holds the generator back on purpose.
- A call without a limit, whose handler never answers, waits until the connection closes.
