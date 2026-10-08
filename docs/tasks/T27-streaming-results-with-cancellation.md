# T27: Streaming results with cancellation

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** downloads, exports, ffmpeg jobs and LLM token streams need progress and cancellation.
  There is no streaming kind.
- **Scope:**
  - New verb `stream<(opts: O) => AsyncIterable<Chunk>>()`; the `as` form from T00 also works.
  - The main handler is an `async function*`.
  - Transport is a per-call `MessageChannelMain`: chunks, then `end`/`error`, then `close`.
  - The renderer gets `ipc.<name>.stream(...args, { signal?: AbortSignal }): AsyncIterable<Chunk>`.
    Abort propagates to main and calls `return()` on the generator.
- **Tests:** runtime tests: full stream, abort mid-stream, error mid-stream, backpressure-free
  ordering.
- **Delivered:** 2026-10-08. Deviations and notes:
  - New verb `stream<(...args) => AsyncIterable<Chunk>, Errors?>(config?)`, new channel kind `Stream`
    (direction `RendererToMain`). The return type may also be `AsyncIterableIterator<Chunk>` or
    `AsyncGenerator<Chunk, ...>`; the parser reads the chunk type (`signature.chunkType`) and rejects
    any other return type. The options are `allowedOrigins` and `validate`, as for `invoke`, and the
    second type argument lists error types. The clone check looks at the chunk type, not the iterable.
  - Deviation: there is no `{ signal?: AbortSignal }` argument, and the page gets an `IpcStream`, not a
    bare `AsyncIterable`. Checked in Electron 44.7.0 (a throwaway app under xvfb): `contextBridge` copies
    an `AbortSignal` as an empty object, so the preload script cannot listen to it. A returned object
    with `next`, `return` and `[Symbol.asyncIterator]` does cross, and `for await` works on it. So
    `ipc.<name>.stream(...args)` returns `{ next, return, cancel, [Symbol.asyncIterator] }`; `break`,
    `return()` and `cancel()` stop the stream, and a page with a signal calls `stream.cancel()` from its
    `abort` listener. Older Electron versions than 44 were not tried.
  - The handshake is an `ipcMain.handle` / `ipcRenderer.invoke` call with a page-chosen numeric ID in
    front of the arguments. The envelope of `settleInvoke` reports a failure to start (rejected sender,
    invalid arguments, no handler, a handler that throws before it returns, no async iterable), so no
    port exists for those. On success the main process makes a `MessageChannelMain`, posts one port to
    the sender frame (or the contents) on `<channel>:port` with the ID, and drives the iterator over the
    other one. This reuses the handler registry, the disposer and the sender and argument checks of
    `invoke`. A stream has `handle` only (no `handleOnce`), and always uses the envelope, `rawErrors` or not.
  - Messages on the port: `{ type: 'chunk', value }` in order, then `{ type: 'end' }` or
    `{ type: 'error', error }`, then the main process closes the port. The page cancels with
    `{ type: 'cancel' }` and closes its port. The main process calls `iterator.return()` once on a
    cancel message, a closed port or destroyed contents, and sends nothing after it. A chunk that cannot be
    cloned stops the iterator and fails the stream with `IPC_STREAM_UNSENDABLE`. Other codes:
    `IPC_STREAM_NOT_ITERABLE`, `IPC_STREAM_INVALID_REQUEST`, `IPC_STREAM_INVALID_REPLY`,
    `IPC_STREAM_CLOSED` (the port closed before the end).
  - The stream starts when `stream(...)` is called, not at the first read. Reads may be made several at a
    time and resolve in order. Chunks before an error are read first.
  - No backpressure, as the task says; follow-up T74. A generator that is waiting is stopped when it next
    yields (that is how `return()` of an async generator works).
  - The error helpers (`IpcErrorInfo`, `IpcEnvelope`, `toIpcError`) of the preload script are now emitted
    for `ask` and `stream` channels together. The doc comment of `IpcError` in `window.d.ts` mentions
    streams. `Symbol`, `AsyncIterable`, `AsyncIterator` and `IteratorResult` are reserved names of
    `main.ts`; `IpcStream`, `Symbol` and `IteratorResult` of `window.d.ts`.
  - Tests: parser, validators, writer text, runtime tests of the generated main and preload scripts
    with fakes, a round trip between both over real `MessageChannel` ports, and a type-checked fixture
    (`stream-channels`). Also run by hand in Electron 44.7.0 under xvfb (not part of the suite): a full
    stream, `for await` with `break`, `cancel()` and an abort listener, an error with `name`, `code` and
    `data`, an uncloneable chunk, a channel without a handler, 2000 chunks in order, concurrent `next()`
    calls, and navigating away and destroying the window mid-stream (the generator's `finally` ran each time).
