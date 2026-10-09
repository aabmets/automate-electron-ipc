# T80: Validation and timeouts for service worker calls

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T36. `invokeFromWorker` and `sendFromWorker` take `allowedOrigins` only. What a
  worker sends is as untrusted as what a page sends, but the options of T17 (`validate`) and T28
  (`timeoutMs`) do not exist for these verbs, and a call whose handler never answers waits for ever.
- **Scope:**
  - `validate` (a Standard Schema of the argument tuple) for `invokeFromWorker` and `sendFromWorker`,
    run in the route of the worker before the callback, with the rules of T17: an invalid `invoke`
    is rejected with an `IpcValidationError` (as a plain object for the worker), an invalid `send` is
    dropped, and `onRejected` of `configureServiceWorkerIpc` hears of both.
  - `timeoutMs` for `invokeFromWorker` and the default `timeoutMs` of the config, with the plain
    `IpcTimeoutError` object of `withTimeout`. The preload script of the worker is the page writer, so the
    `withTimeout` of the page preload is reused; `ServiceWorkerPreloadWriter` sets the timeout to `0` now.
  - Decide whether a timeout is also needed for the questions of `askWorker` from the schema (they have
    `invokeWith(worker, { timeoutMs }, ...)` already).
- **Tests:** parser and validator tests for the options, runtime tests with fake timers and a fake schema,
  and a real-Electron scenario with a hanging handler and one with invalid arguments.
- **Delivered:** 2026-10-09. Deviations and notes:
  - `validate` is an option of `invokeFromWorker` and `sendFromWorker`, and `timeoutMs` of
    `invokeFromWorker` (a non-negative integer literal, `0` for none). `askWorker` and `emitToWorker`
    take neither. Public types: `WorkerCallConfig` got `validate`, and `WorkerInvokeConfig` (new, for
    `invokeFromWorker`) adds `timeoutMs`.
  - Validation runs in the route of the worker in `main.ts`, after the sender check and before the
    callback, with the `validateArguments` of T17, which got an optional `report` argument: the page
    call sites are unchanged, and a worker call reports to `configureServiceWorkerIpc({ onRejected })`
    instead of `configureIpc`. A file with validated worker channels and no validated page channels
    has `validateArguments` without the page hook. An invalid `invokeFromWorker` call is rejected with
    an `IpcValidationError` in the envelope (a plain object for the worker, code `IPC_VALIDATION`), an
    invalid message is dropped. When a worker channel has a validator, `onRejected` gets a third
    argument, an `IpcValidationError` or, for a call that the sender check rejected, an
    `IpcWorkerError` (as the hook of pages does with `IpcForbiddenError`).
  - The handler or the listeners are looked up after the schema has answered, so `handleOnce` and
    `once` are used up by the first valid call only, also with an asynchronous schema, and a call that
    finds no handler is answered with `IPC_WORKER_NO_HANDLER` without being validated.
  - Deviation, found in real Electron: the plan was to reuse `withTimeout` of the page preload, but the
    preload script of a service worker has no `setTimeout` or `setImmediate` (only `queueMicrotask`),
    so the generated code failed with "setTimeout is not defined". The timer is in `main.ts`
    instead: `timeWorkerCall` races the result of the handler against a timer, and the rejection goes
    through the envelope, so the worker gets the same plain object, `{ name: 'IpcTimeoutError',
    message, code: 'IPC_TIMEOUT' }`. The timer starts when the call arrives, so it covers a slow
    schema as well (and, as for pages, the handler is not stopped, so a call that timed out during
    validation still runs the handler, and its reply is dropped). The default `timeoutMs` of the config
    applies. With `rawErrors` there is no envelope: the main process still rejects, the worker gets
    the error of Electron, and `service-worker.d.ts` does not declare `IpcTimeoutError`. The
    preload writer has `getTimeoutMs() === 0`; the typings writer declares `IpcTimeoutError` for a
    call with a timeout.
  - Decision: no `timeoutMs` for `askWorker` in the schema. The caller is the main process, which has
    `invokeWith(worker, { timeoutMs }, ...)` already (as in T79).
  - Tests: parser, validators, public types, the writers, runtime tests with fake timers and fake
    schemas on the main side (`tests/test_e2e/serviceWorkerGuards.test.ts`, fixture
    `service-worker-guards`, type-checked for the page project and the worker project), and
    real-Electron scenarios `validation` and `timeout` in `serviceWorkers.test.ts` (a hanging handler,
    invalid arguments of a call and of a message).
