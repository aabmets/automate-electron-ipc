# T81c: Serializer for service worker channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T37, split from T81. The channels of service workers (`invokeFromWorker`,
  `sendFromWorker`, `emitToWorker`, `askWorker`) carry their values with the structured clone algorithm,
  so a class instance loses its prototype there while it keeps it on an `invoke`.
- **Scope:**
  - Apply the serializer between the main process and the preload script of a service worker: the hub
    of `main.ts` and the writer of `service-worker-preload.ts`. Keep `usesSerializer()` of that writer
    in step with what the hub does.
  - Keep the order of T37 in the hub: the sender check, then deserializing, then the `validate` schema.
  - Update the README section on serializers, which then covers every channel except the `data` of an
    error.
- **Tests:** runtime round trips for each channel kind, an e2e type-check, and a real-Electron group
  next to the service worker one.
- **Delivered:** 2026-10-09. Notes:
  - `isSerializedSpec` covers `ServiceWorkerToMain` and `MainToServiceWorker`, so `main.ts` and
    `service-worker-preload.ts` import the serializer for them. The page `preload.ts` leaves worker specs
    out (`PreloadBindingsWriter.isSerializedSpec`), and the worker writer (which maps its channels to those
    of a page and reuses the page code) counts only the worker channels in `hasSerializedChannels()`, so
    the page channels of the schema do not decide whether it imports the module. `usesSerializer()` of
    the worker writer is no longer turned off.
  - Hub, in `main.ts`: the order is the sender check (`isWorkerAllowed`), the missing-handler check, then
    `readArguments` (a call, which throws into the envelope) or `readSentArguments` (a message, which is
    logged and dropped, after the listeners are looked up, so a `once` listener is not used up), then the
    `validate` schema on the deserialized arguments. The result of a call is encoded after the handler
    has answered in time (`encodeValue(info.channel, await ...)`), inside `settleInvoke`, or in an async
    route with `rawErrors`. `emitToWorker` posts `[encodeValue(name, [args])]`, as a page emit does;
    `askServiceWorker` encodes the question inside its `try`, before `startTask`, so a failure rejects the
    promise and starts no task, and decodes the answer with the `IPC_ASK_INVALID_REPLY` fallback of a
    page ask. The call site of an `askWorker` channel passes the plain list, since the helper encodes.
  - The `serializer-no-pages` fixture had two worker channels to stay serializer-free. Now only a
    `port` channel is left that way (the main process pairs the pages and reads no message), so the
    fixture uses it and the e2e test asserts that `main.ts` has no serializer and `preload.ts` has one.
  - A `send` of the worker that cannot be serialized throws a plain object that `contextBridge` turns
    into an `Error` with the message only: the real-Electron group has an `it.fails` for it, with T82.
  - Tests: writer text tests (`tests/test_writer/serializer.test.ts`), mock-runtime round trips with an
    e2e type-check of `main.ts` and the worker script (`tests/test_e2e/serializerWorkers.test.ts`,
    fixtures `serializer-worker` and `serializer-worker-raw-errors`), and a real-Electron group
    (`tests/test_electron/serializerWorkers.test.ts`). `createWorker` and `createSession` moved from
    `serviceWorkers.test.ts` to `tests/utils/service-worker-utils.ts`; the runner now inlines the
    serializer module into `service-worker-preload.js` as it does for `preload.js`, and adds no `__env`
    to the worker script.
