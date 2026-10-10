# The Electron security checklist

The [checklist of the Electron documentation](https://www.electronjs.org/docs/latest/tutorial/security) numbers its items. This page lists the ones that the library touches by their titles. The library sets none of the `webPreferences` and none of the other items for you, so the rest of the list stays your job.

| Checklist item | What the library does | What you do |
|:--|:--|:--|
| Validate the sender of all IPC messages | `allowedOrigins` compares `senderFrame.origin` for equality, `configureIpc({ validateSender })` runs your rule, and `scopes` admits a call by the window. A frame that is gone is always rejected. | Set `allowedOrigins` on every `invoke`, `send` and `stream`, because without it nothing is checked. Add `validateSender` for rules that origins cannot state. |
| Enable context isolation | The preload script exposes the API with `contextBridge`, and errors cross it as plain objects. | Keep `contextIsolation: true` (the default). |
| Enable process sandboxing | The generated preload script uses only what a sandboxed preload script may load. | Keep `sandbox: true`, and build `preload.ts` as the sandboxed preload scripts need, see [Preload bundling and the sandbox](../tooling/preload-bundling.md). |
| Do not enable Node.js integration for remote content | The API does not need it. | Keep `nodeIntegration: false` (the default), and `nodeIntegrationInSubFrames` off. |

Items that this library has no part in include the secure content and CSP items, the permission request handler, navigation and new window limits, `shell.openExternal`, `<webview>`, the fuses and the version of Electron. See the documentation of Electron for them.

For the checks behind the first row, see [Sender validation](sender-validation.md), [Validating arguments](validating-arguments.md) and [Scopes](scopes.md).
