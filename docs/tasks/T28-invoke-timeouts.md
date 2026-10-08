# T28: Invoke timeouts

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** a hung main handler leaves the renderer's promise pending forever.
- **Scope:**
  - Per-channel `timeoutMs` schema option, plus a global default in config.
  - The preload races the invoke and rejects with `IpcTimeoutError`.
- **Tests:** runtime tests with fake timers.
- **Delivered:** 2026-10-08. Deviations and notes:
  - `timeoutMs` is an option of `invoke` only (not `stream`, `send` or `ask`; `ask` already has
    `invokeWith(target, { timeoutMs })`). It is a non-negative integer literal. `0` turns the
    timeout off for the channel, also when the config sets a default. The global default is
    `timeoutMs` in the `autoipc` config of `package.json`, `0` (no timeout) by default.
  - The error is a plain object `{ name: 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' }`, not an
    `IpcTimeoutError` class, for the same `contextBridge` reason as in T18. `window.d.ts` declares
    the type `IpcTimeoutError` and documents it in `@throws`, only when some channel can time out.
    The name is reserved there.
  - The timer starts in the preload script when the call is made, and covers the transit and a busy
    main process too. The handler is not cancelled and its late reply is dropped.
  - With `rawErrors`, the timeout still applies, and only it is documented in `@throws`.
  - Not done: a timeout for `stream` channels (the wait for the first chunk) and a per-call timeout
    chosen by the page; the schema is the only place for it.
