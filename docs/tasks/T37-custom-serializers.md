# T37: Custom serializers

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `Date`, `Map` and class instances lose fidelity or prototype across IPC.
- **Scope:**
  - Optional config pointing at a module exporting `serialize`/`deserialize` (superjson-compatible
    shape).
  - Applied symmetrically in generated main and preload code.
  - Off by default.
- **Tests:** runtime round-trip tests.
- **Delivered:** 2026-10-09. Deviations and notes:
  - Config `serializer` (a string): a value that starts with `.` is a file from the project root,
    resolved to `serializerFilePath` and imported relative to each generated file (with the NodeNext
    extension rules of the other imports); anything else is a package specifier, such as `superjson`.
    The module is imported by name, `serialize` and `deserialize`, under the aliases `ipcSerialize` and
    `ipcDeserialize`, which are cast to `(value: unknown) => unknown`, so the module's own types are free
    (superjson's generics type-check). Both functions must be synchronous.
  - The call is serialized as one value: the list of the arguments, and the result as a second one.
    Covered: `invoke` (arguments and result), `send`, `emit` (also `sendToSender`, `broadcast`,
    `broadcastTo` and `bind`), `ask` (question and answer) and `stream` (arguments and every chunk).
    Not covered, since they do not go through the page wrappers and have their own protocols: `port`
    channels, utility process channels and service worker channels. The writer of the service worker
    preload script reuses the page writer, so it turns the serializer off (`usesSerializer()`); the main
    process routes the traffic of a worker through its own code. Follow-up: T81.
  - Order in `main.ts`: the sender check, then deserializing, then the `validate` schema on the
    deserialized arguments. A rejected sender never reaches the code of the serializer. A `once` or
    `handleOnce` is used up by the first message that could be read.
  - Failures: `encodeValue` and `decodeValue` throw an `IpcSerializationError` in the main process
    (exported, code `IPC_SERIALIZATION`) and a plain `{ name, message, code }` object in the preload
    script, like the other errors of the library. A call that is answered (`invoke`, `stream` start, the
    question of an `ask`) reports it in the error envelope; a `send` or an `emit` that cannot be read is
    logged with `console.error` and dropped, so that nothing is thrown into Electron; a chunk that cannot
    be read fails the stream, and one that cannot be written is the existing `IPC_STREAM_UNSENDABLE`.
    An answer of an `ask` that cannot be read rejects with `IPC_ASK_INVALID_REPLY`.
  - With `rawErrors` the handler is registered through an async wrapper that serializes its result, and
    the page's `invoke` is `async` so that a failure to serialize rejects instead of throwing.
  - `window.d.ts` is unchanged: the types are those of the signatures, and `IpcError` covers the
    serialization error. `contextBridge` copies what the preload script revives into the page, so a class
    instance reaches the page as a plain object; the README says so.
  - The real-Electron runner now inlines the relative `require`s of the preload script (the serializer
    module), since a sandboxed preload can only require `electron`; a bundler does that for an app.
  - Tests: config and validator tests, writer text tests (`tests/test_writer/serializer.test.ts`), mock
    runtime round trips of main and preload against each other (`tests/test_e2e/serializer.test.ts`, with
    the fixtures `serializer`, `serializer-raw-errors` and `serializer-no-pages`), an e2e type-check, and
    a real-Electron group (`tests/test_electron/serializer.test.ts`).
