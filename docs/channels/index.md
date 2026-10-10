# Channels

Channels are the verbs that connect a page and the main process: a request with an answer, a message in
each direction, a question to a page and a stream of results. This section describes each of them, with
the schema, the code that you write in the main process and in the page, and the code that the library
generates. The channels that involve a utility process, a service worker or another page are in
[Processes](../processes/index.md).

| Verb | Direction | What it is | Page |
|---|---|---|---|
| `invoke` | page to main | A request that is answered with a value (`ipcRenderer.invoke` and `ipcMain.handle`) | [invoke](invoke.md) |
| `send` | page to main | A message without an answer (`ipcRenderer.send` and `ipcMain.on`) | [send](send.md) |
| `emit` | main to page | A message without an answer (`webContents.send`) | [emit](emit.md) |
| `ask` | main to page | A question to a page that is answered with a value | [ask](ask.md) |
| `stream` | page to main | Many results for one call, which the page can cancel | [stream](stream.md) |

The options of each verb:

| Verb | Options |
|---|---|
| `invoke` | `timeoutMs`, `allowedOrigins`, `validate`, `scopes` |
| `send` | `allowedOrigins`, `validate`, `scopes` |
| `emit` | `trigger`, `scopes` |
| `ask` | `scopes` |
| `stream` | `highWaterMark`, `allowedOrigins`, `validate`, `scopes` |

`invoke` and `stream` take the error types of their handlers as a second type argument. The pages
describe the options in turn; `allowedOrigins`, `validate` and `scopes` are the subject of
[Security](../security/index.md). Every wire name is the name of the channel behind the `channelPrefix` of
the config (`"autoipc:"` by default; see [Configuration](../tooling/configuration.md)).

Registering for the contents of one window is described in
[Handlers for one window](send.md#handlers-for-one-window).
