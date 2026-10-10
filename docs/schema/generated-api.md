# The generated API

Every channel becomes an object named after its key in the channel map, and the methods of the object depend on the
verb of the channel and on the process that uses it. This page is the map of those methods. The pages of each kind of
channel describe them in detail, with the code that is generated.

## Methods by verb

| Verb     | Main process (`ipc` from `main.ts`) | Renderer (global `ipc`, also `window.ipc`)        |
|----------|-------------------------------------|---------------------------------------------------|
| `invoke` | `ipc.<name>.handle(callback)`, `handleOnce(callback)` | `ipc.<name>.invoke(...args)`            |
| `send`   | `ipc.<name>.on(callback)`, `once(callback)` | `ipc.<name>.send(...args)`                |
| `emit`   | `ipc.<name>.send(target, ...args)`, `sendToSender(event, ...args)`, `broadcast(...args)`, `broadcastTo(filter, ...args)`, and `bind(...)` when the channel has a `trigger` | `ipc.<name>.on(callback)`, `once(callback)` |
| `ask`    | `ipc.<name>.invoke(target, ...args)`, `invokeWith(target, options, ...args)` | `ipc.<name>.handle(callback)` |
| `stream` | `ipc.<name>.handle(callback)`, where the callback is an `async function*` | `ipc.<name>.stream(...args)` |
| `port`   | `ipc.<name>.connect(winA, winB)`    | `ipc.<name>.send(...args)`, `on(callback)`, `onReady(callback)`, `onClose(callback)`, `onOverflow(callback)`, `onConnection(callback)` |
| `mainPort` | `ipc.<name>.connect(target)`      | the same as `port`                                |
| `callUtility` | `ipc.<name>.invoke(child, ...args)` | none: the utility process has `ipc.<name>.handle(callback)` |
| `notifyUtility` | `ipc.<name>.send(child, ...args)` | none: the utility process has `ipc.<name>.on(callback)` and `once(callback)` |
| `callMain` | `ipc.<name>.handle(child, callback)` | none: the utility process has `ipc.<name>.invoke(...args)` |
| `notifyMain` | `ipc.<name>.on(child, callback)`, `once(child, callback)` | none: the utility process has `ipc.<name>.send(...args)` |
| `invokeUtility` | `ipc.<name>.connect(child, target)` | `ipc.<name>.invoke(...args)`; the utility process has `ipc.<name>.handle(callback)` |
| `streamUtility` | `ipc.<name>.connect(child, target)` | `ipc.<name>.stream(...args)`; the utility process has `ipc.<name>.handle(callback)` |
| `invokeFromWorker` | `ipc.<name>.handle(session, callback)`, `handleOnce(session, callback)` | none: the service worker has `ipc.<name>.invoke(...args)` |
| `sendFromWorker` | `ipc.<name>.on(session, callback)`, `once(session, callback)` | none: the service worker has `ipc.<name>.send(...args)` |
| `askWorker` | `ipc.<name>.invoke(worker, ...args)`, `invokeWith(worker, options, ...args)` | none: the service worker has `ipc.<name>.handle(callback)` |
| `emitToWorker` | `ipc.<name>.send(worker, ...args)`, `broadcast(session, ...args)` | none: the service worker has `ipc.<name>.on(callback)` and `once(callback)` |

The main process, the utility processes and the service workers each have their own generated file: `main.ts`
exports the `ipc` object of the main process, `utility.ts` the `ipc` object of a utility process, and the preload
script of a service worker exposes the API of the worker. The renderer API is declared as the global `ipc`, and the
preload script exposes it in the page.

## Details that the table leaves out

- The `handle`, `handleOnce`, `on` and `once` of a channel between a page and the main process take an optional last
  argument, `{ webContents }`. With it the registration is bound to the contents of one page: only its messages
  arrive, and the registration is removed when the contents are destroyed. Every `handle`, `handleOnce`, `on` and
  `once` returns a function which removes the registration.
- A `handle` replaces an earlier handler of the same channel, and a `handleOnce` removes itself on the first call it
  receives. The renderer registers the single responder to an `ask` with `handle`.
- The callbacks that the main process registers for `invoke`, `send`, `stream`, `invokeFromWorker` and
  `sendFromWorker` receive the Electron event as their first argument, followed by the arguments of the signature.
  All other callbacks receive the arguments only.

Each kind has a subsection in [Channels](../channels/index.md) or [Processes and workers](../processes/index.md) with its
declaration, the generated API of the main process and of the renderer, and an excerpt of the generated code. The
examples are checked in CI: each is generated and type-checked. The excerpts are copied from the generated files, with
`// ...` where lines are left out.
