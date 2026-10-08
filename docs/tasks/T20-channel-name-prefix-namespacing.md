# T20: Channel name prefix / namespacing

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** raw channel names like `GetUser` can collide with other libraries or app code using
  `ipcMain` directly.
- **Scope:** add a config option `channelPrefix`, default `"autoipc:"`, applied to the wire channel
  names only (`getUser` travels as `"autoipc:getUser"`). `""` disables it. API member names are
  unchanged.
- **Tests:** writer tests, plus an e2e test.
- **Delivered:** 2026-10-08. Notes:
  - The option is `channelPrefix` in the `autoipc` config of `package.json`. It is validated: up to
    64 characters from `A-Za-z0-9_.:/@#-`, so that it cannot break the string literals of the
    generated code. A schema file or a channel cannot change it.
  - Only the names that are passed to Electron are prefixed: `ipcMain.handle`, `on`, `off` and
    `removeHandler`, `ipcRenderer.invoke`, `send`, `on`, `once` and `removeListener`, and the
    `send` and `postMessage` calls to a window. The names that `validateSender`, `onRejected` and
    the errors receive, and the internal handler registry, keep the name from the schema.
  - `window.d.ts` is identical with and without a prefix.
  - The writers read a missing `channelPrefix` as `""`; the resolved config of a real run always
    has it, with the default `"autoipc:"`.
  - Breaking for code that uses a raw channel name; the README says how to opt out.
