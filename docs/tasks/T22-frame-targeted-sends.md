# T22: Frame-targeted sends

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** there is no way to reply to the specific iframe that sent a request
  (`webFrameMain.send` / `webContents.sendToFrame`).
- **Scope:**
  - Accept `WebFrameMain` as a `send<X>` target.
  - Add a helper `send<X>.toSender(event, ...args)` that targets `event.senderFrame`, capturing it
    synchronously.
- **Tests:** runtime tests, including a detached/null frame.
- **Delivered:**
