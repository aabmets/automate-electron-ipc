# T16: Sender validation (Electron security checklist #17)

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [index](./README.md).

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
- **Delivered:**
