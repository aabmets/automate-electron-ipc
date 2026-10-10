# Threat model

This page says what the library assumes about the renderer, and which checks the generated `main.ts` makes when you set no options.

## What the library assumes

The library assumes that a renderer can be compromised, and treats everything that comes from one as untrusted input:

- **Script that you did not write runs in the page.** A cross-site scripting hole, a bad dependency, or a remote page that a window loads can call every function that the preload script exposes, with any arguments. TypeScript types are erased at runtime, so `ipc.getUser.invoke("x")` reaches the main process although the signature says `number`.
- **A frame that is not yours has the same API.** A child window opened by `window.open` loads the preload script of its parent unless you say otherwise, and an iframe does when `nodeIntegrationInSubFrames` is on. Both can show another origin, and the call of any of them reaches the same handler as a call of the top page.
- **The renderer process is taken over.** An attacker with code execution in the process does not need your preload script: it sends messages to `ipcMain` on the wire names of the channels (`autoipc:getUser`). So a rule that only the preload script enforces, such as the API of a scope, protects nothing here. Every rule that matters is checked again in the main process, by the generated `main.ts`.

What the library cannot do is make your handlers safe. A handler that reads a path or runs a command for the page must decide, for each call, whether the page may ask for that. The checks in this section keep the wrong caller and malformed input out of the handler; they do not tell the handler what is allowed.

## What the main bindings check by default

Without any option, these are the checks of the generated `main.ts`:

| Channel | Checked without options |
|:--|:--|
| `invoke`, `send`, `stream` | Nothing about the sender: any frame of any window may call. Arguments are not checked at runtime. |
| `ask` | The answer counts only when it comes from the contents (and the frame, for a frame target) that was asked, and for a question that is still pending. |
| `port`, `mainPort` | The main process pairs the windows; a page cannot pair itself with another. A request to end a connection is honored only from the contents that hold that end. Messages on the port are not checked: validate what a page receives from its peer. |
| `invokeUtility`, `streamUtility`, `callUtility`, `notifyUtility`, `callMain`, `notifyMain` | The two ends are your own code, so they have no `allowedOrigins` or `validate`. The main process connects the page to the child. |
| `invokeFromWorker`, `sendFromWorker` | Nothing, as for the page. A worker has no `senderFrame`, so `allowedOrigins` compares the origin of its scope, and the hook is `configureServiceWorkerIpc`. See [Service workers](../processes/service-workers.md). |

So for the three channels that a page calls, you turn the checks on per channel (`allowedOrigins`, `validate`, `scopes`) or for all of them (`validateSender`).

## What a page gets back

A handler's error reaches the page as `name`, `message`, `code` and `data`, without a stack (see [Errors](../channels/invoke.md#errors)). Those four are yours to keep free of secrets. With `rawErrors`, there is no such envelope: Electron puts the message of the error in the text that the page sees.

## Where the API is exposed

The preload script exposes the API with `contextBridge` under the name `exposeAs` (`ipc` by default), and never hands the page `ipcRenderer` itself. By default the API is in the main world, so every script of the page can use it. With `isolatedWorldId`, only scripts that run in that isolated world can. With `autoExpose` off, your own preload code decides when and under which key to expose it. See [Preload bundling and the sandbox](../tooling/preload-bundling.md).

`channelPrefix` puts a prefix in front of the names that Electron sees (`autoipc:` by default), which keeps other code on `ipcMain` from colliding with the channels. It is no defense against a caller that knows the names.

The rest of this section turns the other checks on, per channel.
