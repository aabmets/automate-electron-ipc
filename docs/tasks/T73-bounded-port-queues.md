# T73: Bounded send queues of port channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T26. `send` of a port channel queues its messages whenever
  there is no port: before the page has loaded, after the port closed while the contents are still
  alive, and, for the channel itself, while there is no connection yet. The queues are unbounded.
  A main process that tails a log into a window which has not loaded, or has navigated away, holds
  every message in memory until the page comes back or `close()` is called.
- **Decided (2026-10-08):**
  - `maxQueue` is a schema option of `port` and `mainPort`: a non-negative integer literal, or
    `Infinity`. The default is 1000 messages. Messages are counted, not bytes, since the size of a
    payload is not cheap to measure. `0` is allowed: nothing is queued, and every message that is
    sent while there is no port goes through the overflow path.
  - It applies to both verbs and to every queue: the pending queue of each connection in the
    preload script, the queue of the channel in the preload script that waits for the first
    connection, and the pending queue of each connection in `main.ts` (`mainPort`).
  - The overflow callback is not a schema option, since the schema is parsed and never executed
    and the generated code has no dependency on this library. It is registered at run time, with a
    global default and a per-connection override, in both processes.
  - The page callback must not cost O(`maxQueue`) per message: `contextBridge` copies every argument
    that crosses it, and a queue at its limit would be copied once per dropped message. So the page
    callback gets only the new message and returns an action. The main callback gets the queue,
    since main has no bridge to cross.
  - Warnings: a drop is logged with `console.warn` the first time a queue drops a message, and again
    at every 100th dropped message (100, 200, ...). A count of the warnings is kept.
- **Scope:**
  - **Schema:** `maxQueue` on `port` and `mainPort` (types, parser, validator, README). The default
    of 1000 is a constant of the generated code. Anything but a number literal, a negative or a
    fractional number is an error that names the channel.
  - **Main (`main.ts`, `mainPort` only):**
    - The overflow hook is `onOverflow(queue, message, info)`. `queue` is the array of messages that
      are waiting (each one is the argument list of a `send`), `message` is the argument list that
      did not fit, and `info` is `{ channel, max, dropped, warnings }`. `dropped` is the number of
      messages that this queue has dropped so far, and `warnings` the number of warnings it has
      logged.
    - It returns the array of messages to keep, which covers dropping the oldest, dropping the
      newest, coalescing and clearing. If the array is longer than `maxQueue`, the oldest messages
      are dropped to fit, and counted. If the callback throws or returns anything but an array, the
      error is logged and the oldest message is dropped.
    - The default, with no callback, is to drop the oldest message.
    - The global default is set with a function that exists whenever a port channel does (a new
      `configurePorts({ onOverflow })`, since `configureIpc` is declared only for channels that
      the renderer calls). Each connection has `onOverflow(callback)`, which replaces the global
      callback for that connection, and `onOverflow(undefined)` removes the override.
  - **Page (`preload.ts`, `window.d.ts`, for `port` and `mainPort`):**
    - The callback is `onOverflow(message, info)`, with the same `info`, and returns the action
      `'dropOldest'`, `'dropNewest'` or `'clear'`. `'clear'` drops everything that is queued and
      queues the new message. A throw or any other value logs the error and drops the oldest.
    - `ipc.<name>.onOverflow(callback)` is the global default of the channel, and each connection
      object has `onOverflow(callback)` as the override. Both return a disposer.
    - The queue of the channel that waits for the first connection uses the channel's callback.
  - **Warnings:** the text names the channel and `maxQueue`, says that messages are being dropped,
    and gives the number of dropped messages and of warnings so far. The counts are per queue and
    are never reset, so a queue that drains and overflows again continues its count.
  - **Types:** `window.d.ts` and `main.ts` type the messages from the signature of the channel (the
    parameters as a tuple), and the callbacks accordingly.
  - **README:** document `maxQueue`, the default, `0`, the two callbacks and their different
    shapes (and why), and the warning policy.
- **Tests:**
  - Parser and validator tests for `maxQueue`: the numbers that are accepted (`0`, `1000`,
    `Infinity`), the ones that are not, and the verbs that do not take it.
  - Runtime tests of the generated preload script and main bindings, for each queue: a limit is
    kept, the oldest message is dropped by default and the newest are flushed in order, `0`
    queues nothing, `Infinity` never drops, and a queue that drained takes new messages again.
  - The callbacks: the action of each kind on the page, the returned array on main (shorter, longer
    than the limit, not an array), a throwing callback, the override over the global default and
    the removal of the override, and the page callback getting the message but not the queue.
  - The warning policy: one at the first drop, none until the 100th, one at the 100th and the 200th,
    the counts in `info` and in the text, and no reset after a drain.
  - An e2e type-check of a schema that uses `maxQueue` and both callbacks.
- **Delivered:**
