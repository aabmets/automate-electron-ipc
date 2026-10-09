# T94: The preload adds one `ipcRenderer` listener per subscription

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T87. In `src/writer/preload-bindings.ts`, `on` and `once` of a
  main-to-renderer channel add one `ipcRenderer` listener per subscription. Each disposer removes its
  own, so nothing leaks, but more than ten subscribers to one channel may print
  `MaxListenersExceededWarning` in the renderer. Not verified in a real renderer yet.
- **Scope:**
  - Confirm the warning in real Electron (a scenario with eleven subscribers to one channel).
  - If it shows, keep one `ipcRenderer` listener per channel with a list of callbacks behind it, in
    the shape of `watchEvent` of the main bindings (T87). Take care of `once`, of a callback that
    unsubscribes during a dispatch, and of deserializing the arguments once per message.
- **Tests:** a real-Electron scenario with many subscribers, and unit tests that count the
  `ipcRenderer` listeners of the fake.
- **Delivered:**
