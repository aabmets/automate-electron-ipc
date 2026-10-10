# stream channels

A `stream` channel sends many results for one call, and the page can stop it. Use it for downloads,
exports, long jobs and token streams. The signature takes the arguments of the call and returns an
`AsyncIterable<Chunk>` (or an `AsyncIterableIterator<Chunk>` or an `AsyncGenerator<Chunk>`), and the
handler in the main process is an `async function*`. The second type argument lists the error types, as
for `invoke`.

## Declaring, handling and reading

<!-- readme-example: kind-stream src/autoipc/schema.ts -->
```ts
import { defineChannels, stream } from "automate-electron-ipc";

export interface Row {
   id: number;
   name: string;
}

export default defineChannels({
   exportRows: stream<(table: string, limit?: number) => AsyncIterable<Row>>(),
});
```

In the main process the handler is an `async function*`. The event comes first, as for the handler of
an `invoke`:

<!-- readme-example: kind-stream src/main/index.ts -->
```ts
import { app } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   ipc.exportRows.handle(async function* (_event, table, limit = 100) {
      const cursor = { close: async () => console.log("closed") };
      try {
         for (let id = 1; id <= limit; id++) {
            yield { id, name: `${table} ${id}` };
         }
      } finally {
         await cursor.close(); // also runs when the renderer cancels
      }
   });
});
```

In the page, `stream(...)` returns an async iterator at once:

<!-- readme-example: kind-stream src/renderer/app.ts -->
```ts
async function fillTable(table: HTMLElement): Promise<void> {
   for await (const row of ipc.exportRows.stream("people", 100)) {
      table.append(`${row.id}: ${row.name}`);
   }
}

fillTable(document.body);
```

Every call gets a `MessageChannelMain` of its own, so the chunks of two calls never mix, and they arrive in
the order that the generator produced them. The page calls `ipc.<name>.stream(...args)`, which asks the
main process through `ipcMain.handle` and returns the stream at once. The main process hands one port of a
new channel to the frame that asked, and sends `chunk` messages over the other one, then `end` or
`error`, and closes it.

A stream starts when `stream(...)` is called, not at the first read. The type of the stream in the page is
`IpcStream<Chunk>`, which the generated `types.ts` declares.

## Cancelling

The stream is an async iterator with one more method, `cancel()`:

<!-- readme-example: kind-stream src/renderer/cancel.ts -->
```ts
async function firstRow(): Promise<void> {
   const stream = ipc.exportRows.stream("people");
   const first = await stream.next(); // { done: false, value: row }
   console.log(first.value);
   stream.cancel(); // or: await stream.return()
}

firstRow();
```

`cancel()`, `return()` and the `break` of a `for await` loop stop the stream: the main process calls
`return()` on the generator, so its `finally` blocks run, no chunk is sent after that, and the chunks
that the page has not read yet are dropped. The main process also stops the generator when the page
closes its port, such as when it navigates away, and when its contents are destroyed. A generator that is
waiting for something when the stop arrives is stopped when it next yields, as `return()` of any async
generator is: it cannot be interrupted while it waits.

**There is no `AbortSignal` option**, since `contextBridge` copies an `AbortSignal` as an empty
object (checked in Electron 44.7.0), so the preload script cannot listen to it. A page that has a
signal stops the stream itself:

<!-- readme-example: kind-stream src/renderer/abort.ts -->
```ts
function exportUntilAborted(signal: AbortSignal): void {
   const stream = ipc.exportRows.stream("people");
   signal.addEventListener("abort", () => stream.cancel(), { once: true });
}

exportUntilAborted(new AbortController().signal);
```

## Errors

If the generator throws, the chunks that came before the error are read first. Then the read rejects
with the error object of an `invoke` channel, `{ name, message, code?, data? }` (see
[Errors](invoke.md#errors)), and later reads are `done`. The second type argument documents the error
types, in `types.ts`, as for `invoke`, and the `as` form cannot declare them (see
[The as form](../schema/as-form.md)). A stream always uses this error format, also with `rawErrors`.

If the call cannot start, the first read of the stream rejects instead. This happens when the sender is
not allowed (`IPC_FORBIDDEN`), the arguments are invalid (`IPC_VALIDATION`), no handler is registered
(Electron's own error), or the handler throws before it returns the iterable. The handler does not run
for a sender that is not allowed, or for invalid arguments.

The codes `IPC_FORBIDDEN`, `IPC_VALIDATION` and `IPC_SERIALIZATION` are the ones that `invoke` has (see
[Errors of the library](invoke.md#errors-of-the-library)). `IPC_SERIALIZATION` covers the arguments of the
call and the reading of a chunk in the page; a chunk which the serializer cannot write fails the stream
with `IPC_STREAM_UNSENDABLE`. A failure of the stream itself has the `name` `IpcStreamError` and one of
these codes:

| `code` | When | Message |
|---|---|---|
| `IPC_STREAM_NOT_ITERABLE` | the handler did not return an async iterable (a plain array does not count) | `The handler of the channel '<channel>' did not return an async iterable` |
| `IPC_STREAM_UNSENDABLE` | a chunk cannot be cloned; the generator is stopped | `A chunk of the channel '<channel>' cannot be sent: <reason>` |
| `IPC_STREAM_CLOSED` | the port closes before the stream has ended | `The stream of the channel '<channel>' was closed before it ended` |
| `IPC_STREAM_INVALID_REQUEST` | the call has no stream ID, which the generated preload script always sends | `The call of the channel '<channel>' has no stream ID` |
| `IPC_STREAM_INVALID_REPLY` | the answer to the call is neither an answer nor an error | `The main process sent an unreadable reply to the channel '<channel>'` |

The types of the chunks are checked against the structured clone algorithm when the schema is read (see
[What can be sent](../schema/what-can-be-sent.md)).

## Backpressure

A slow reader slows the generator down. The page grants the main process a window of `highWaterMark`
chunks that it has not read yet (the default is 1024). The main process stops pulling from the generator
when the window is used up, and the page grants more as it reads, in steps of half a window. A page that
stops reading holds at most one window in memory, and the generator waits. `cancel()`, `return()`, a
closed port and destroyed contents stop a paused generator at once, since it is suspended at a `yield`.

`highWaterMark` is the most chunks that the generator may be ahead of the page:

<!-- readme-example: kind-backpressure src/autoipc/schema.ts -->
```ts
import { defineChannels, stream } from "automate-electron-ipc";

export interface Row {
   id: number;
}

export default defineChannels({
   exportRows: stream<(table: string) => AsyncIterable<Row>>({ highWaterMark: 64 }),
   tokens: stream<(prompt: string) => AsyncIterable<string>>({ highWaterMark: Infinity }), // no limit
   rows: stream<() => AsyncIterable<Row>>({ highWaterMark: 0 }), // pull-based
});
```

It is a non-negative integer literal, or `Infinity`. The unit is the chunk, whatever its size, so use a
lower value for large chunks (a window of 1024 chunks of 1 MB is a gigabyte). With `0` the generator is
asked for a chunk only while the page waits for one, which costs a round trip for each chunk. With
`Infinity` nothing is paused and the page sends no credits.

The credits travel over the port of the call, as `{ type: 'credit', limit }` messages from the page,
where `limit` is the total of chunks that the page allows so far. A reader that reads fast sends one
message for half a window of chunks. `streamUtility` channels (see
[Utility processes](../processes/utility-processes.md)) take the same option, and the window is per call,
though all the streams of a channel share one port.

## Handlers and options

- A `stream` channel has one handler, as an `invoke` channel has: registering `handle` again replaces
  the previous one, and a stream that runs keeps the generator it started with. A stream is not cut off
  when a handler is replaced or removed, only when it ends or is cancelled. There is no `handleOnce`.
- `handle` returns a disposer and takes `{ webContents }` as a second argument (see
  [Handlers for one window](send.md#handlers-for-one-window)).
- `allowedOrigins` and `validate` work as they do for `invoke` (see
  [Sender validation](../security/sender-validation.md) and
  [Validating arguments](../security/validating-arguments.md)); `scopes` works as well (see
  [Scopes](../security/scopes.md)).
- A stream has no `timeoutMs`: a handler that never yields leaves the read pending until the page cancels.
- With a `serializer` in the config, the arguments and each chunk go through it (see
  [Custom serializers](../schema/custom-serializers.md)).

## What the library generates

The page opens the stream, and the handler of the main process is wrapped to start it for every call
(abridged):

```ts
// preload.ts
exportRows: {
   stream: (...args: any[]) => openStream('exportRows', 'autoipc:exportRows', args, 1024),
},
```

```ts
// main.ts
exportRows: {
   handle: (callback: (event: IpcMainInvokeEvent, table: string, limit?: number) => AsyncIterable<Row>, options?: IpcListenOptions) => {
      // ...
      const listener = (event: IpcMainInvokeEvent, id: unknown, ...rest: unknown[]) =>
         settleInvoke(() => startStream(event, 'exportRows', 'autoipc:exportRows', id, 1024, () => (handler as (...rest: unknown[]) => unknown)(event, ...rest)));
      target.ipc.removeHandler('autoipc:exportRows');
      target.ipc.handle('autoipc:exportRows', listener);
      // ...
      return remove;
   },
},
```
