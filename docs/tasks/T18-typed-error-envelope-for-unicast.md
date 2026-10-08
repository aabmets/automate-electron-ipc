# T18: Typed error envelope for Unicast

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** errors thrown in `handle` reach the renderer only as
  `Error invoking remote method 'X': Error: msg`. Class, `code`, custom fields and cause are lost.
- **Scope:**
  - The main wrapper catches errors and returns
    `{ ok: false, error: { name, message, code?, data? } }` (or `{ ok: true, value }`). The preload
    unwraps it and rejects with the error object.
    - Not an `IpcError` class: `contextBridge` copies a thrown `Error` with only its message and
      stack, so `name`, `code` and `data` would be lost. A plain object keeps them (verified in
      Electron 44.7.0). The renderer checks `error.name` or `error.code`, not `instanceof`.
  - Let the schema declare error types so `window.d.ts` documents them.
    - Generic form: a second type argument, `invoke<Sig, NotFoundError | AuthError>()`.
    - The `as` form has no slot for errors. Document that errors need the generic form.
  - Opt-out config for raw Electron behavior: `rawErrors` in the `autoipc` config of `package.json`.
- **Tests:** runtime round-trip tests (thrown Error, thrown custom error with code/data, thrown
  non-Error value), plus an e2e type-check.
- **Delivered:** 2026-10-08. Deviations and notes:
  - The renderer gets a plain object, not an `IpcError` instance, because of `contextBridge`
    (above). The global type `IpcError<E>` in `window.d.ts` describes that object, and follows the
    literal `name`, `code` and `data` types of the declared classes.
  - `rawErrors` is one global switch, not a per-channel option, so main, preload and `window.d.ts`
    always agree. It defaults to `false`.
  - The errors of the library itself use the envelope: `IpcForbiddenError` has the code
    `IPC_FORBIDDEN`, and `IpcValidationError` the code `IPC_VALIDATION` with its issues as `data`
    (symbols in paths are turned into strings, so that the data can be cloned).
  - `data` is copied with `structuredClone` and left out when that fails, so a bad `data` cannot
    fail the whole reply. A returned `value` that cannot be cloned still fails the reply with
    Electron's own message; T19 checks for that at generation time.
  - Breaking for code that read Electron's `Error invoking remote method` message: the message is
    now the handler's own, and the rejection is not an `Error`. The README says so.
  - The handlers reply asynchronously now, even when the handler and the schema are synchronous.
  - Error types are imported into `window.d.ts` and renamed on collisions like signature types. The
    global `Error` is a reserved name there, since `IpcError` refers to it.
