# The generated API

Every channel becomes an object named after its key in the channel map, such as `ipc.getUser`. The methods of
the object depend on the verb of the channel and on the process that uses it. This page is the map of those
methods. The pages of each kind of channel describe them in detail, with the code that is generated.

## Where the API lives

- **Main process:** `main.ts` exports the `ipc` object. Import it with `import { ipc } from "../autoipc/main"`.
- **Renderer:** the preload script exposes the API in the page, and `window.d.ts` declares it as the global
  variable `ipc` (also `window.ipc`). The name is the `exposeAs` option of the
  [configuration](../tooling/configuration.md). With scopes, each scope gets a file set of its own.
- **Utility process:** `utility.ts` exports the `ipc` object of a utility process.
- **Service worker:** the generated preload script of the worker exposes the API of the worker.

The channels of a verb do not appear where they do not belong: a `send` channel has no `ipc.<name>` member in
`utility.ts`, and a `callUtility` channel has none in the page.

## Methods by verb

### Page and main process

| Verb | Main process (`ipc` from `main.ts`) | Renderer (global `ipc`, also `window.ipc`) |
|------|-------------------------------------|--------------------------------------------|
| `invoke` | `ipc.<name>.handle(callback)`, `handleOnce(callback)` | `ipc.<name>.invoke(...args)` |
| `send` | `ipc.<name>.on(callback)`, `once(callback)` | `ipc.<name>.send(...args)` |
| `emit` | `ipc.<name>.send(target, ...args)`, `sendToSender(event, ...args)`, `broadcast(...args)`, `broadcastTo(filter, ...args)`, and `bind(...)` when the channel has a `trigger` | `ipc.<name>.on(callback)`, `once(callback)` |
| `ask` | `ipc.<name>.invoke(target, ...args)`, `invokeWith(target, options, ...args)` | `ipc.<name>.handle(callback)` |
| `stream` | `ipc.<name>.handle(callback)`, where the callback is an `async function*` | `ipc.<name>.stream(...args)` |
| `port` | `ipc.<name>.connect(winA, winB)` | `ipc.<name>.send(...args)`, `on(callback)`, `onReady(callback)`, `onClose(callback)`, `onOverflow(callback)`, `onConnection(callback)` |
| `mainPort` | `ipc.<name>.connect(target)` | the same as `port` |

### Utility process

| Verb | Main process | Utility process (`ipc` from `utility.ts`) | Renderer |
|------|--------------|-------------------------------------------|----------|
| `callUtility` | `ipc.<name>.invoke(child, ...args)` | `ipc.<name>.handle(callback)` | none |
| `notifyUtility` | `ipc.<name>.send(child, ...args)` | `ipc.<name>.on(callback)`, `once(callback)` | none |
| `callMain` | `ipc.<name>.handle(child, callback)` | `ipc.<name>.invoke(...args)` | none |
| `notifyMain` | `ipc.<name>.on(child, callback)`, `once(child, callback)` | `ipc.<name>.send(...args)` | none |
| `invokeUtility` | `ipc.<name>.connect(child, target)` | `ipc.<name>.handle(callback)` | `ipc.<name>.invoke(...args)` |
| `streamUtility` | `ipc.<name>.connect(child, target)` | `ipc.<name>.handle(callback)` | `ipc.<name>.stream(...args)` |

### Service worker

| Verb | Main process | Service worker | Renderer |
|------|--------------|----------------|----------|
| `invokeFromWorker` | `ipc.<name>.handle(session, callback)`, `handleOnce(session, callback)` | `ipc.<name>.invoke(...args)` | none |
| `sendFromWorker` | `ipc.<name>.on(session, callback)`, `once(session, callback)` | `ipc.<name>.send(...args)` | none |
| `askWorker` | `ipc.<name>.invoke(worker, ...args)`, `invokeWith(worker, options, ...args)` | `ipc.<name>.handle(callback)` | none |
| `emitToWorker` | `ipc.<name>.send(worker, ...args)`, `broadcast(session, ...args)` | `ipc.<name>.on(callback)`, `once(callback)` | none |

## Details that the tables leave out

- The `handle`, `handleOnce`, `on` and `once` of a channel between a page and the main process take an optional
  last argument, `{ webContents }`. With it the registration is bound to the contents of one page: only its
  messages arrive, and the registration is removed when the contents are destroyed. Every `handle`,
  `handleOnce`, `on` and `once` returns a function which removes the registration.
- A `handle` replaces an earlier handler of the same channel, and a `handleOnce` removes itself on the first
  call it receives. The renderer registers the single responder to an `ask` with `handle`.
- The callbacks that the main process registers for `invoke`, `send`, `stream`, `invokeFromWorker` and
  `sendFromWorker` receive the Electron event as their first argument, followed by the arguments of the
  signature. All other callbacks receive the arguments only.
- The parameters of a call keep the names, the types and the `?` or `...` of the signature. A destructured
  parameter, which has no name to forward, is called `arg0`, `arg1`, ... after its position.
- With the config `getPathForFile`, the API of the page also has `getPathForFile(file)`, and with `mock`, the
  mock has the helpers `emit` and `ask`. No channel can have those names.

Each kind has a subsection in [Channels](../channels/index.md) or [Processes and workers](../processes/index.md) with its
declaration, the generated API of the main process and of the renderer, and an excerpt of the generated code. The
examples are checked in CI: each is generated and type-checked. The excerpts are copied from the generated files, with
`// ...` where lines are left out.
