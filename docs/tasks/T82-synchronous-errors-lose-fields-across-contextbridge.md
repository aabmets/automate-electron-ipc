# T82: A synchronous error of the preload script loses its fields across `contextBridge`

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T81a, in a real Electron process. The preload script throws the
  plain object `{ name: 'IpcSerializationError', message, code: 'IPC_SERIALIZATION' }` from a `send`
  (T37) and from the `send` of a port channel (T81a) whose arguments the serializer cannot serialize.
  The mock tests see that object, but `contextBridge` turns what a bridged function throws
  synchronously into an `Error` with the message only, so the page gets `{ name: 'Error' }` and no
  `code`. A rejection of a promise keeps the object (the `invoke`, `ask` and `stream` paths), so the
  README claim that "a `send` throws the plain object" is wrong.
  The same may hold for the other errors that the preload script throws synchronously; check them.
- **Scope:**
  - List the errors that the preload script throws synchronously, and probe each in Electron.
  - Decide per case: keep the code in the message text, make the call report through a promise or a
    callback, or document that the page can tell the failure only by its message.
  - Make the README, the tests and the `it.fails` scenarios of T81a and T81c
    (`tests/test_electron/serializerPorts.test.ts`, `tests/test_electron/serializerWorkers.test.ts`, the
    `send` of a service worker) say what is true.
- **Tests:** real-Electron scenarios for each synchronous error; the `it.fails` of T81a turns into a
  passing test, or into an assertion of the documented behavior.
- **Delivered:**
