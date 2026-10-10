# The Electron security checklist

The [checklist of the Electron documentation](https://www.electronjs.org/docs/latest/tutorial/security) lists what an Electron app should do to stay safe. This page maps the items that the library touches to what it does for them and what stays yours. The library sets none of the `webPreferences` and none of the other items for you.

| Checklist item | What the library does | What you do |
|:--|:--|:--|
| Validate the sender of all IPC messages | `allowedOrigins` compares `senderFrame.origin` for equality, `configureIpc({ validateSender })` runs your rule, and `scopes` admits a call by the window. A frame that is gone is always rejected. | Set `allowedOrigins` or `scopes` on every `invoke`, `send` and `stream`, or give `configureIpc` a `validateSender`, because without one of them nothing is checked. Use `validateSender` for rules that origins cannot state. |
| Enable context isolation | The preload script exposes the API with `contextBridge`, and errors cross it as plain objects. | Keep `contextIsolation: true` (the default). |
| Enable process sandboxing | The generated preload script uses only what a sandboxed preload script may load. | Keep `sandbox: true`, and build `preload.ts` as the sandboxed preload scripts need, see [Preload bundling and the sandbox](../tooling/preload-bundling.md). |
| Do not enable Node.js integration for remote content | The API does not need it. | Keep `nodeIntegration: false` (the default), and `nodeIntegrationInSubFrames` off. |
| Do not expose Electron APIs to untrusted web content | The API holds your channels only. It never hands the page `ipcRenderer` or another Electron object. | Do not expose more of Electron in your own preload code. With `getPathForFile` on, the page can turn a `File` it holds into a path; leave it off if no page needs that. |

Items that this library has no part in include the secure content and CSP items, the permission request handler, navigation and new window limits, `shell.openExternal`, `<webview>`, the `file://` protocol, the fuses and the version of Electron. See the documentation of Electron for them.

For the checks behind the first row, see [Sender validation](sender-validation.md), [Validating arguments](validating-arguments.md) and [Scopes](scopes.md). For what the library assumes and checks without any option, see the [Threat model](threat-model.md).
