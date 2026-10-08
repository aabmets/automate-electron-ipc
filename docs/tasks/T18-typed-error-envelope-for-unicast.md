# T18: Typed error envelope for Unicast

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** errors thrown in `handle` reach the renderer only as
  `Error invoking remote method 'X': Error: msg`. Class, `code`, custom fields and cause are lost.
- **Scope:**
  - The main wrapper catches errors and returns `{ ok: false, error: { name, message, code?, data? } }`
    (or `{ ok: true, value }`). The preload unwraps and rethrows an `IpcError` with those fields.
  - Let the schema declare error types so `window.d.ts` documents them.
    - Generic form: a second type argument, `invoke<Sig, NotFoundError | AuthError>()`.
    - The `as` form has no slot for errors. Document that errors need the generic form.
  - Opt-out config for raw Electron behavior.
- **Tests:** runtime round-trip tests (thrown Error, thrown custom error with code/data, thrown
  non-Error value), plus an e2e type-check.
- **Delivered:**
