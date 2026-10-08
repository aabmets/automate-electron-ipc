# T16: Sender validation (Electron security checklist #17)

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** no generated handler checks `event.senderFrame`. Any frame, including iframes and
  child windows, can call every channel.
- **Scope:**
  - The generated `main.ts` exports `configureIpc({ validateSender?: (event, channel) => boolean })`.
  - Add a per-channel schema option `allowedOrigins: ["app://.", "http://localhost:5173"]`, compared
    against the parsed `senderFrame.origin`, never URL prefix matching.
  - Read `senderFrame` synchronously before any `await`; since v33 it can become `null`/detached.
    A null frame means reject.
  - Rejected calls: Unicast rejects with a typed `IpcForbiddenError`; Broadcast drops and calls an
    optional `onRejected` hook.
- **Tests:**
  - Runtime tests with mocked events: allowed origin, wrong origin, `null` senderFrame,
    `example.com.attacker.com` bypass attempt, global validator plus per-channel rule interplay.
  - Parser and validator tests for `allowedOrigins`.
- **Delivered:** 2026-10-08. `invoke` and `send` take `allowedOrigins` (parser, superstruct validator, public types). The generated `main.ts` exports `configureIpc`, `IpcConfig` and `IpcForbiddenError` when the schema has a renderer-to-main channel, and each listener calls a local `guard` first (so that a parameter of the signature cannot shadow a generated name). `senderFrame` is read synchronously; a null frame, a non-string origin, a throwing validator or a validator result other than `true` all reject, and origins are compared for equality. `onRejected` is also called for Unicast. Deviations: (1) `once` and `handleOnce` now use `ipcMain.on` / `handle` with a listener which removes itself after the first allowed message, since `ipcMain.once` would be used up by a rejected sender; (2) `Error` is now a reserved name in `main.ts`, so a schema type `Error` is imported as `Error_2`. Follow-up: the renderer sees only the message of an `IpcForbiddenError`; a typed envelope is T18.
