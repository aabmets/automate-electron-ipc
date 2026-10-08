# T22: Frame-targeted sends

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** there is no way to reply to the specific iframe that sent a request
  (`webFrameMain.send` / `webContents.sendToFrame`).
- **Scope:**
  - Accept `WebFrameMain` as an `ipc.<name>.send` target.
  - Add `ipc.<name>.sendToSender(event, ...args)` that targets `event.senderFrame`, capturing it
    synchronously.
- **Tests:** runtime tests, including a detached/null frame.
- **Delivered:** 2026-10-08. Notes:
  - `send` accepts `BrowserWindow | WebContents | WebContentsView | WebFrameMain`. A frame has its
    own `send`, so `resolveSendTarget` passes it through, and `send` to a destroyed frame throws,
    like for the other targets.
  - `sendToSender(event, ...args)` takes `{ readonly senderFrame: WebFrameMain | null }`, so the event
    of `on`, `handle`, or any other Electron IPC event fits. It reads `senderFrame` once, at the call.
  - Deviation: it returns a boolean instead of `void`. It sends nothing and returns `false` for a
    missing, destroyed or detached frame, or one that throws when inspected, since the sender having
    gone is no error of the caller. An error of the send itself, such as data that cannot be cloned,
    still throws. `isDestroyed` is called as optional, for Electron versions that lack it.
  - `WebFrameMain` and `sendToSenderFrame` are reserved names in `main.ts`, so schema types of
    those names are renamed.
  - Not checked against a running Electron here; the frame behavior is covered with a fake frame.
