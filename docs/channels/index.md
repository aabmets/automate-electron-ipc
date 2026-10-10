# Channels

A channel is one named connection between a page and the main process. You declare it in the schema with
a verb, and the library generates the code for both ends. This section describes the five verbs that
connect a page and the main process: a request with an answer, a message in each direction, a question
to a page, and a stream of results. For each verb the page shows the schema, the code that you write in
the main process and in the page, and the code that the library generates. The channels that involve a
utility process, a service worker or another page are in [Processes](../processes/index.md).

## Choosing a verb

| Verb | Direction | What it is | Page |
|---|---|---|---|
| `invoke` | page to main | A request that is answered with a value (`ipcRenderer.invoke` and `ipcMain.handle`) | [invoke](invoke.md) |
| `send` | page to main | A message without an answer (`ipcRenderer.send` and `ipcMain.on`) | [send](send.md) |
| `emit` | main to page | A message without an answer (`webContents.send`) | [emit](emit.md) |
| `ask` | main to page | A question to a page that is answered with a value | [ask](ask.md) |
| `stream` | page to main | Many results for one call, which the page can cancel | [stream](stream.md) |

## Options

Each verb takes an optional object of options. A verb rejects an option that it does not support when the
generator reads the schema.

| Verb | Options |
|---|---|
| `invoke` | `timeoutMs`, `allowedOrigins`, `validate`, `scopes` |
| `send` | `allowedOrigins`, `validate`, `scopes` |
| `emit` | `trigger`, `scopes` |
| `ask` | `scopes` |
| `stream` | `highWaterMark`, `allowedOrigins`, `validate`, `scopes` |

The pages describe `timeoutMs`, `trigger` and `highWaterMark` in turn. `allowedOrigins`, `validate` and
`scopes` are the subject of [Security](../security/index.md). `invoke` and `stream` also take the error
types of their handlers as a second type argument.

## What the channels have in common

- **The two ends.** In the main process you import `ipc` from the generated `main.ts` file. In the page,
  the API is the global `ipc` that the preload script exposes (the name is the `exposeAs` key of the
  config; see [Configuration](../tooling/configuration.md)).
- **Disposers.** Every function that registers something (`on`, `once`, `handle`, `handleOnce`, `bind`)
  returns a function which removes that registration.
- **Wire names.** Electron sees the name of the channel behind the `channelPrefix` of the config
  (`"autoipc:"` by default), so `getUser` travels as `autoipc:getUser`.
- **Serializers.** When the config names a `serializer`, the arguments, the results and the chunks of
  every channel go through it (see [Custom serializers](../schema/custom-serializers.md)).
- **One window.** The main-process registrations of `invoke`, `send` and `stream` channels can be made
  for the contents of a single window (see [Handlers for one window](send.md#handlers-for-one-window)).

## Errors at a glance

| Verb | How a failure reaches the caller |
|---|---|
| `invoke` | The promise rejects with a plain object `{ name, message, code?, data? }`. The library adds the codes `IPC_FORBIDDEN`, `IPC_VALIDATION` and `IPC_TIMEOUT`. See [Errors](invoke.md#errors). |
| `send` | A message from a sender that is not allowed, or with invalid arguments, is dropped. |
| `emit` | `send` throws Electron's error for a target that is destroyed. |
| `ask` | The promise rejects with an `IpcAskError` which has a `code` that starts with `IPC_ASK_`. See [Errors](ask.md#errors). |
| `stream` | A read of the stream rejects with a plain object whose `code` can start with `IPC_STREAM_`. See [stream](stream.md#errors). |
