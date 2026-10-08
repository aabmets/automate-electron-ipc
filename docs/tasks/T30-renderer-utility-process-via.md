# T30: Renderer ↔ utility process via a brokered port

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the renderer cannot talk directly to a utility process, so every DB query hops through
  main.
- **Scope:**
  - The main brokers a `MessageChannelMain` between a window and a `UtilityProcess`.
  - The renderer gets typed invoke/stream calls over the port; the utility side gets handlers.
- **Tests:** runtime tests with mocks.
- **Delivered:** 2026-10-08. Deviations and notes:
  - Two verbs, with no options: `invokeUtility` (Unicast) and `streamUtility` (Stream), both with the new
    direction `RendererToUtility`, and the optional second type argument for the error types, like
    `invoke` and `stream`. The task said "invoke/stream calls".
  - Main: `ipc.<name>.connect(child, target)` (a window, a view or contents) returns `{ close }`. It
    makes a `MessageChannelMain`, posts port1 to the child as `{ __ipc: 'port', channel, key }` and
    port2 to the page on the channel, with the same key. It pairs once the page has loaded and again on
    every load (`watchPageLoad`, now emitted whenever a port or a broker channel exists). It ends on
    `close()`, when the child exits and when the contents are destroyed, and tells the page through
    `<channel>:close`. Connecting a channel to a page again replaces the earlier connection (a registry
    keyed by channel and contents ID). The brokering is per channel, so each channel can have its own
    child. `main.ts` does not import the types of these signatures.
  - Child: `ipc.<name>.handle(callback)` in `utility.ts`, for both kinds (a stream handler returns an
    async iterable). The listener on `process.parentPort` also accepts `port` messages, for the channels
    of the file only, and any other port is closed. A port serves one channel. A `call` is served by the
    existing peer code (`receiveUtilityMessage`), a `stream` message starts the handler and pumps
    `chunk`, `end` or `error` messages with the call ID, so all the streams of a channel share the one
    port. `cancel`, and the close of the port, stop the iterator once with `return()`.
  - Page: `ipc.<name>.invoke(...)` and `.stream(...)`. A call made before the port arrives waits for it,
    in order. A closed connection rejects at once with `IPC_UTILITY_EXITED` (the child exited, `close()`,
    a replaced port), and so does a call that was open. The errors are plain objects (`contextBridge`).
    New code `IPC_UTILITY_NOT_ITERABLE`. `window.d.ts` declares `IpcUtilityError` when such a channel
    exists. The stream reader of the preload script is now `createStreamReader`, shared with the `stream`
    channels of the main process (same behavior, new internals).
  - Tests: parser, validators, all four writers, mock runtime tests for each of the three generated
    scripts and for all three together over real `MessageChannel` ports (e2e type-check fixtures
    `utility-ports` and `utility-ports-only`), and a real-Electron group
    (`tests/test_electron/utilityPorts.test.ts`) with a real utility process, a sandboxed window, errors,
    streams, cancel, close, child exit, reload and two pages. `createSource` moved to `runtime-utils`.
  - Not done, noted in other tasks: timeouts for the calls of a page (T79), backpressure (T74). One port
    per channel means that the main process calls `connect` once per channel; a call that connects all
    the channels of a child to a page at once was left out. A generator that is stuck in an `await`
    cannot be stopped by `return()` until it resumes, as with the `stream` channels.
