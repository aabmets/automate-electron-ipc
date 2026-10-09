# T81a: Serializer for port channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T37. The `serializer` of the config applies to the channels between a page and
  the main process only. `port` and `mainPort` channels carry their values with the structured clone
  algorithm, so a class instance loses its prototype there while it keeps it on an `invoke`.
- **Why a split:** T81 as first written covered five transports (the two kinds of port channel, the
  channels of utility processes, the ports that the main process brokers between a page and a utility
  process, and the channels of service workers). Each has its own protocol and its own generated runtime,
  so it was split in three, one commit each: this task (T81a), the utility process (T81b) and the
  service worker (T81c).
- **Scope:**
  - Apply the serializer at both ends of a `port` channel (page to page) and of a `mainPort` channel
    (main to page): a message is posted as a list of one value, the list of the arguments as the
    serializer made it, and a message that arrives is deserialized the same way.
  - Failures: a `send` that cannot be serialized throws when a port is there; a queued message is
    serialized when the queue is flushed, and one that cannot be is logged and dropped; a message that
    cannot be deserialized is logged and dropped.
  - The main process only pairs the pages of a `port` channel, so `main.ts` does not import the
    serializer for it.
  - Document what is covered in the README section on serializers.
- **Tests:** writer text tests, mock-runtime round trips of the preload scripts over real
  `MessageChannel`s and of `main.ts` against `preload.ts` over a real channel
  (`tests/test_e2e/serializerPorts.test.ts`, fixture `serializer-ports`), an e2e type-check, and a
  real-Electron group (`tests/test_electron/serializerPorts.test.ts`).
- **Delivered:** 2026-10-09. Split from T81 (see above); the rest is T81b and T81c. Notes:
  - `BaseWriter.isSerializedSpec` now covers `RendererToRenderer` ports (the `port` verb) as well as the
    channels of T37, and `MainBindingsWriter` turns it off for them, since the main process only pairs
    the pages. `mainPort` channels (`MainToRenderer`) are serialized in both files.
  - Wire shape: a message is posted as `[encodeValue(channel, args)]`, and read with `readArguments`
    (preload) or `readSentArguments` (main), so a message that is not a list of one value is logged and
    dropped, and a message that is not an array is ignored, as before.
  - A queued message is serialized when the queue is flushed, not when `send` is called, so that the
    overflow callbacks keep getting the arguments as the caller passed them. The cost: a queued message
    that cannot be serialized is logged and dropped at the flush, while a `send` with a port throws.
  - Found, not fixed: a real Electron process shows that `contextBridge` turns what the preload script
    throws synchronously into an `Error` with the message only, so the page gets no `code`. This holds
    for the `send` of T37 as well, and contradicts the README of T37. Added as T82 and as an `it.fails`
    scenario in `tests/test_electron/serializerPorts.test.ts`. The main process throws a real
    `IpcSerializationError`.
  - The fixture `serializer-no-pages` had a `port` channel that was meant to use no serializer; it
    now has an `invokeFromWorker` channel instead, since the preload script serializes ports now.
