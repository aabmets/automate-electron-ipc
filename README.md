# Automate Electron IPC

[![Node LTS](https://img.shields.io/node/v-lts/automate-electron-ipc?style=flat&label=node&color=%231B7EBC)](https://nodejs.org/en/download/prebuilt-installer/current)
[![NPM License](https://img.shields.io/npm/l/automate-electron-ipc)](https://github.com/aabmets/automate-electron-ipc/blob/main/LICENSE)
[![Code Coverage](https://codecov.io/gh/aabmets/automate-electron-ipc/graph/badge.svg?token=xg3PJRlo3o)](https://codecov.io/gh/aabmets/automate-electron-ipc)
[![NPM Downloads](https://img.shields.io/npm/dw/automate-electron-ipc)](https://www.npmjs.com/package/automate-electron-ipc)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)<br/>
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=bugs)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)

### Description

Node library for generating IPC components for Electron apps.


### Features

1) Declarative IPC schema using a typed channel map
2) Generation of one typed object per channel for the main process, `ipc.<name>`
3) Generation of preload bindings for renderer processes
4) Generation of typehints for the `ipc` object of the renderer, also reachable as `window.ipc`
5) Automatic import of user-defined types for generated components
6) BrowserWindow event triggers for `emit` channels
7) `ask` channels, with which the main process asks a renderer and awaits the answer
8) `stream` channels, with which the main process streams results to a renderer, which can cancel
9) Typed channels between the main process and a `utilityProcess`, in a generated `utility.ts`
10) Typed calls and streams from a renderer straight to a `utilityProcess`, over a port that the main
    process brokers
11) Scopes, which give each kind of window its own API and keep the others out in the main process
12) Typed channels between the main process and a service worker (Electron 35 or later, experimental),
    with a generated preload script and typings for the worker


### Installation

`bun add automate-electron-ipc --dev`

`pnpm add automate-electron-ipc --save-dev`

`yarn add automate-electron-ipc --dev`

`npm install automate-electron-ipc --save-dev`


### Optional Configuration

You can configure IPC automation in the `package.json` file using the following options. 
If no configuration is provided, IPC automation will use the default values as shown in the example below.

```json
{
   "config": {
      "autoipc": {
         "projectUsesNodeNext": false,
         "ipcDataDir": "src/autoipc",
         "codeIndent": 3,
         "rawErrors": false,
         "channelPrefix": "autoipc:",
         "timeoutMs": 0,
         "utilityBindingsPath": "src/autoipc/utility.ts",
         "serviceWorkerPreloadPath": "src/autoipc/service-worker-preload.ts",
         "exposeAs": "ipc",
         "autoExpose": true,
         "getPathForFile": false
      }
   }
}
```

Config explanation:
 - `projectUsesNodeNext` - Must be set to true when `moduleResolution` in `tsconfig.json` is `nodenext`.
 - `ipcDataDir` - Relative path to a directory within the users project which will contain the IPC schema expressions and where the IPC bindings will be generated into.
 - `codeIndent` - How many spaces will one code indentation level have within the generated IPC bindings.
 - `rawErrors` - Set to true to leave the errors of `invoke` handlers to Electron. See [Errors](#errors).
 - `channelPrefix` - Put in front of every channel name that Electron sees, so that the channels cannot
   collide with other code that uses `ipcMain` or `ipcRenderer` directly: `getUser` travels as
   `autoipc:getUser`. The names of the generated API stay as they are in the schema, and so do the names
   that `validateSender`, `onRejected` and the errors receive. Set it to `""` to turn the prefix off.
   It can contain letters, digits and `_ . : / @ # -`, up to 64 characters. It separates channel names
   and is not a security measure: restrict who can call a channel with `allowedOrigins`.
 - `timeoutMs` - The default time in milliseconds after which the promise of an `invoke` is rejected
   with an `IpcTimeoutError`. `0`, the default, waits for ever. It is also the default of `callUtility`,
   `callMain` and `invokeUtility`, which reject with an `IpcUtilityError` of the code
   `IPC_UTILITY_TIMEOUT`, and of `invokeFromWorker`. See [Timeouts](#timeouts).
 - `utilityBindingsPath` - Relative path of the generated file for utility processes, `utility.ts` in
   `ipcDataDir` by default. It must be a `.ts` file, and not the path of another generated file. The
   file is written only when the schema has a channel to a utility process. See
   [Utility processes](#utility-processes).
 - `serviceWorkerPreloadPath` - Relative path of the generated preload script for service workers,
   `service-worker-preload.ts` in `ipcDataDir` by default. The typings of the worker are written next to
   it, as `service-worker.d.ts`. It must be a `.ts` file, and not the path of another generated file. Both
   files are written only when the schema has a channel to or from a service worker. See
   [Service workers](#service-workers).
 - `exposeAs` - The name that the API of the page is exposed as, `ipc` by default: `window.ipc`. The
   generated `window.d.ts` declares the global variable under the same name. It must be an identifier
   that is not a reserved word or a global of the page (`name`, `status`, `close`, `open`, `Promise`, ...),
   since the exposed API would hide it. The `ipc` object of `main.ts` is not affected.
 - `isolatedWorldId` - Exposes the API in the isolated world with this ID, with
   `contextBridge.exposeInIsolatedWorld`, instead of in the main world. It must be an integer of 1000 or
   more, since Electron keeps the lower IDs for itself. Only the scripts that run in that world see the
   API, so the world needs to be created for the page, for example with `webFrame.setIsolatedWorldInfo`.
   Without it, the API is exposed in the main world.
 - `autoExpose` - Whether the generated `preload.ts` exposes the API as soon as it loads, `true` by
   default. Set it to `false` to expose the API from your own preload code. See
   [Composing the preload script](#composing-the-preload-script).
 - `getPathForFile` - Adds `getPathForFile(file: File): string` to the exposed API, `false` by default.
   `File.path` was removed in Electron 32, so a page that handles dropped or picked files can get their
   path only from the preload script, through `webUtils.getPathForFile`. The helper wraps that call, and
   is typed in `window.d.ts`. It returns an empty string for a `File` that is not on the disk, and
   throws for a value that is not a `File`. A channel cannot be named `getPathForFile` while this is on.
   It is in the API of every scope, and in the empty API of a schema without channels for the page.
   Keep in mind that a path tells the page about the disk of the user: pass it on only to code you trust.
 - `serializer` - A module with the functions `serialize` and `deserialize`, applied to everything that
   crosses between a page, a utility process or a service worker and the main process, and to the messages
   of `port` and `mainPort` channels, so that a `Date`, a `Map` or a class instance arrives as it was sent. Off by default. A value that starts with `.` is a path from the project root, such as
   `"./src/wire.ts"`; any other value is a package, such as `"superjson"`. See
   [Custom serializers](#custom-serializers).


### Composing the preload script

The generated `preload.ts` exports the API it builds, and a function that exposes it:

```ts
export const api = { /* one object per channel */ };
export function expose(key = "ipc"): void { /* contextBridge.exposeInMainWorld(key, api) */ }
expose();   // only with "autoExpose": true, the default
```

By default the file calls `expose()` itself, so using it as the preload script of a window works as
before. With `"autoExpose": false` nothing is exposed while the file loads, and your own preload code
decides what happens:

```ts
// src/preload.ts
import { api, expose } from "./autoipc/preload";

expose();                // under the configured key, `exposeAs`
expose("legacyIpc");     // under another key
doSomethingBefore(api);  // or use the API in the preload script itself
```

The default key of `expose` is `exposeAs`, and with `isolatedWorldId` it exposes in that isolated
world. Every call exposes the same `api` object, so the state of the channels (listeners, ports,
streams) is shared between the keys. Only the key that `window.d.ts` declares (`exposeAs`) is typed
for the page.

### Getting Started

IPC bindings are generated by calling the `ipcgen` command provided by this library from the command line. 
When you initially run this command, you will get a warning about IPC channels not being found. 
Do not let this warning dissuade you, as it's purpose is to guide you where to create the schema 
file or directory, which will contain the channel expressions that will be parsed by IPC automation. 

By default, IPC automation looks for a file named `schema.ts` in the IPC data directory. 
If you create a directory named `schema` into the IPC data directory, then IPC automation 
will recursively parse all files within it for channel maps, meaning it is possible 
to structure and segment channels according to the needs of larger applications. 


### Channel Maps

IPC automation reads channels from a channel map: an object passed to `defineChannels` that is exported from a schema file.
The key of each property is the channel name, the verb helper picks the kind of the channel, and the type argument
of the verb is the signature. The schema file is never executed by Node. Instead, this library parses it to deduce
the meanings behind the declarations, so the config of a verb must be written as an object literal.

Since this library is well-documented through its type definitions, the developer is encouraged to use an IDE 
which facilitates easy type inference and hints within its user interface. To that end, you should configure your 
`tsconfig.node.json` to include the generated `main.ts` and `preload.ts` files from within the IPC data directory.
For the renderer process, you should include the generated `window.d.ts` file into your `tsconfig.web.json` file.

_Note: IPC automation does not make a distinction between senders/listeners and invokers/handlers as they are 
defined in the IPC documentation of the Electron library. Whether an IPC component is generated as a sender/listener
or invoker/handler under the hood depends on the verb of the channel. The reason
behind this design choice was to allow the user to focus on IPC arguments and return types without having to
concern themselves with IPC internals._

Rules of the schema file:
 - Export the map with `export default defineChannels({...})` or `export const channels = defineChannels({...})`.
 - Use only one `defineChannels` call per file. In a `schema` directory, each file may have its own map.
 - Channel names are plain identifier keys of any length and case, such as `ok`, `on` or `onReady`. Spreads, computed keys and nested objects are not supported.
 - Each channel becomes an object named after its key, such as `ipc.echoUserName`. Names that every object has, such as `constructor` or `toString`, are rejected.
 - Aliased imports work, such as `import { invoke as call } from "automate-electron-ipc"`.


### Simple Example

Schema file content at path `src/autoipc/schema.ts`:
```typescript
import { defineChannels, send } from "automate-electron-ipc";

export default defineChannels({
   echoUserName: send<(userName: string) => void>(),
});
```

After IPC bindings have been generated by running `ipcgen`, they can be used as described below.  
_Note: For brevity sake, other important code related to BrowserWindow has been omitted._

In main process source code file `src/main/index.ts`:
```typescript
import { app } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   ipc.echoUserName.on((event, userName) => console.log(`Greetings, ${userName}!`));
});
```

Anywhere in renderer process source code:
```html
<button onClick={() => ipc.echoUserName.send("Anonymous")}>
```

In the renderer, `ipc` is a global variable, so `window.ipc.echoUserName.send("Anonymous")` and
`globalThis.ipc` are the same typed object. The main process imports its own `ipc` from the generated
`main.ts`; it is a different object with the methods of the main process.

The example code provides only basic HTML, because this library is front-end-tech agnostic,
meaning you can use any front-end framework or library like React, Vue or Angular.


### Verbs

Each verb declares one kind of channel in one direction:

```typescript
import {
   defineChannels, invoke, send, emit, ask, stream, port, mainPort,
   callUtility, notifyUtility, callMain, notifyMain, invokeUtility, streamUtility,
   invokeFromWorker, sendFromWorker, askWorker, emitToWorker,
} from "automate-electron-ipc";

export default defineChannels({
   // Request from a renderer process to the main process with return data
   getUser: invoke<(id: number) => Promise<User>>(),

   // Message from a renderer process to the main process without return data
   echoUserName: send<(userName: string) => void>(),

   // Message from the main process to a renderer process without return data,
   // optionally with a generated binder which sends when a BrowserWindow event fires
   progress: emit<(n: number) => void>({ trigger: "focus" }),

   // Request from the main process to a renderer process with return data
   hasUnsavedChanges: ask<(documentId: number) => boolean>(),

   // Request from a renderer process to the main process with a stream of results, which the
   // renderer can cancel
   exportRows: stream<(table: string) => AsyncIterable<Row>>(),

   // Sender and listener on same port for each of two renderer processes
   chat: port<(msg: string) => void>(),

   // Sender and listener on one port between the main process and a renderer process
   logTail: mainPort<(line: string) => void>(),

   // Request from the main process to a utility process with return data
   indexFile: callUtility<(path: string) => Promise<number>>(),

   // Message from the main process to a utility process without return data
   setLogLevel: notifyUtility<(level: "debug" | "info") => void>(),

   // Request from a utility process to the main process with return data
   getSetting: callMain<(key: string) => Promise<string | undefined>>(),

   // Message from a utility process to the main process without return data
   indexed: notifyMain<(done: number, total: number) => void>(),

   // Request from a renderer process to a utility process with return data, over a brokered port
   queryRows: invokeUtility<(sql: string) => Promise<Row[]>>(),

   // Request from a renderer process to a utility process with a stream of results
   scanRows: streamUtility<(table: string) => AsyncIterable<Row>>(),

   // Request from a service worker to the main process with return data
   getToken: invokeFromWorker<(scope: string) => Promise<Token>>(),

   // Message from a service worker to the main process without return data
   syncDone: sendFromWorker<(pending: number) => void>(),

   // Request from the main process to a service worker with return data
   flushQueue: askWorker<(force: boolean) => number>(),

   // Message from the main process to a service worker without return data
   configChanged: emitToWorker<(key: string) => void>(),
});
```

| Verb     | Direction          | Return type of the signature |
|----------|--------------------|------------------------------|
| `invoke` | RendererToMain     | any value or promise         |
| `send`   | RendererToMain     | `void` or `Promise<void>`    |
| `emit`   | MainToRenderer     | `void` or `Promise<void>`    |
| `ask`    | MainToRenderer     | any value or promise         |
| `stream` | RendererToMain     | `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` |
| `port`   | RendererToRenderer | `void` or `Promise<void>`    |
| `mainPort` | MainToRenderer   | `void` or `Promise<void>`    |
| `callUtility` | MainToUtility | any value or promise         |
| `notifyUtility` | MainToUtility | `void` or `Promise<void>`  |
| `callMain` | UtilityToMain    | any value or promise         |
| `notifyMain` | UtilityToMain  | `void` or `Promise<void>`    |
| `invokeUtility` | RendererToUtility | any value or promise      |
| `streamUtility` | RendererToUtility | `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` |
| `invokeFromWorker` | ServiceWorkerToMain | any value or promise    |
| `sendFromWorker` | ServiceWorkerToMain | `void` or `Promise<void>`  |
| `askWorker` | MainToServiceWorker | any value or promise            |
| `emitToWorker` | MainToServiceWorker | `void` or `Promise<void>`    |

The verbs for utility processes take no options, and neither do `askWorker` and `emitToWorker`. The
channels that a service worker calls have `allowedOrigins` and `validate`, and `invokeFromWorker` also
`timeoutMs`. The only option of the others that is
not described in its own section is `trigger` of `emit`, a BrowserWindow event name such as `"focus"`.
The sender of an `emit` channel, `ipc.progress.send(browserWindow, n)`, always sends immediately.
With a `trigger`, the channel also has `ipc.progress.bind(browserWindow, provider)`.
It registers one listener for the event, calls `provider` each time the event fires, sends the
argument list that `provider` returns (or resolves to), and returns a function which removes the
listener:

```typescript
const dispose = ipc.progress.bind(browserWindow, () => [currentProgress()]);
// Later, to stop sending on focus:
dispose();
```

If `provider` throws or rejects, that send is skipped and later events still send. The error goes to
the optional third argument, `(error: unknown) => void`, or to `console.error` without it:

```typescript
ipc.progress.bind(browserWindow, () => [currentProgress()], (error) => log.warn(error));
```


### The Generated API

Every channel is an object named after its key in the channel map. The methods of the object depend
on the verb of the channel and on the process that uses it:

| Verb     | Main process (`ipc` from `main.ts`) | Renderer (global `ipc`, also `window.ipc`)        |
|----------|-------------------------------------|---------------------------------------------------|
| `invoke` | `ipc.<name>.handle(callback)`       | `ipc.<name>.invoke(...args)`                      |
| `send`   | `ipc.<name>.on(callback)`           | `ipc.<name>.send(...args)`                        |
| `emit`   | `ipc.<name>.send(target, ...args)`, `sendToSender(event, ...args)`, `broadcast(...args)`, `broadcastTo(filter, ...args)` | `ipc.<name>.on(callback)` |
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

In the renderer, `on` and `once` of an `emit` channel return a function which removes that one
listener, so a component can unsubscribe when it unmounts:

```typescript
useEffect(() => ipc.progress.on((percent) => setPercent(percent)), []);
```

`once` delivers a single message. The callback never receives the Electron event.

In the main process, `on` and `once` of a `send` channel, and `handle` and `handleOnce` of an
`invoke` channel, return a function which removes that registration (`ipcMain.off` and
`ipcMain.removeHandler`). `once` and `handleOnce` serve a single message or call.

An `invoke` channel has one handler. Registering `handle` or `handleOnce` again replaces the
previous handler, instead of throwing as `ipcMain.handle` does, so that re-creating a window or
hot-restarting the main process works. The disposer of a replaced handler does nothing.

#### Handlers for one window

Every `on`, `once`, `handle` and `handleOnce` of a channel that a page calls (also the `handle` of a
`stream` channel) takes a second argument, `{ webContents }`. With it, the registration is made on
`webContents.ipc` of those contents instead of on the global `ipcMain`, so a window that keeps its own
state does not have to look it up by `event.sender.id`:

```typescript
function openDocument(win: BrowserWindow, doc: Document) {
   ipc.getDocument.handle(async () => doc, { webContents: win.webContents });
   ipc.documentEdited.on((_event, text) => doc.update(text), { webContents: win.webContents });
}
```

The registration returns a disposer as usual, and removes itself when the contents are destroyed
(the disposer can be called afterwards without harm). Contents that are already destroyed throw a
`TypeError`, because nothing would ever reach them. All the registrations of some contents share one
`destroyed` listener.

Electron dispatches a message from a page first to `webContents.ipc` and then to `ipcMain`:

- An `invoke` is answered by the first of the two that has a handler, so a handler of the contents
  wins over the global one for that page, and the global handler still serves the other pages. A
  channel can have one handler on each target, and `handle` replaces only the handler of its own
  target.
- A `send` goes to the listeners of both, so a global `on` still hears a message that a listener of
  the contents heard. Register on the contents only when the global listener does not need to run
  for that page.

The checks that apply to the channel (`allowedOrigins`, `scopes`, `configureIpc`, `validate`) run
for the registrations of the contents as well. Frame-scoped handlers (`webFrameMain.ipc`) are not
generated.

#### Sending to windows

`ipc.<name>.send(target, ...args)` of an `emit` channel takes a `BrowserWindow`, a `WebContentsView`,
a `WebContents` or a `WebFrameMain`, so a message can go to a window, to a view inside it, to its
contents, or to one frame:

```typescript
ipc.progress.send(mainWindow, 50);
ipc.progress.send(view, 50);
ipc.progress.send(mainWindow.webContents, 50);
ipc.progress.send(mainWindow.webContents.mainFrame, 50);
```

`sendToSender(event, ...args)` replies to the exact frame that sent the event you are handling, such
as an iframe, which a `send` to the window would not reach. It takes the event of any handler:

```typescript
ipc.search.on((event, query) => {
   ipc.searchStarted.sendToSender(event, query); // replies to the iframe that asked
});
```

Electron clears `event.senderFrame` once the frame navigates or is destroyed, and `sendToSender`
reads it at the moment of the call, so call it before the first `await`; after one, the frame may
already be gone. It returns `true` when the message went out, and `false` when there was nobody to send
to: no frame, or a frame that is destroyed or detached. Unlike `send`, which throws for a target
that the caller handed over and that is destroyed, a reply to a sender that has gone is not an error.

`broadcast(...args)` sends to every open `WebContents`, such as the windows and views of the app,
for something that all of them show (a theme or a setting). Contents that are destroyed are skipped.
`broadcastTo(filter, ...args)` sends only to the contents that `filter` accepts:

```typescript
ipc.theme.broadcast("dark");
ipc.theme.broadcastTo((contents) => contents.getURL().startsWith("app://settings"), "dark");
```

`broadcast` covers all contents that Electron reports, DevTools included, so use `broadcastTo` when
only some of them should get the message. The filter comes first, because the options of a signature
may end in optional or rest parameters, which would swallow an options argument. `send` still throws
for a target that is destroyed, since the caller handed it over.

#### Asking a renderer

Electron has no invoke from the main process to a renderer. An `ask` channel adds one, for questions
such as "are there unsaved changes?" when a window closes:

```typescript
// schema.ts
hasUnsavedChanges: ask<(documentId: number) => boolean>(),

// main process
window.on("close", async (event) => {
   event.preventDefault();
   const unsaved = await ipc.hasUnsavedChanges.invoke(window, currentDocument);
   if (!unsaved) window.destroy();
});

// renderer: one responder per channel, which may answer in a promise
const dispose = ipc.hasUnsavedChanges.handle((documentId) => editor.isDirty(documentId));
```

`invoke(target, ...args)` takes the same targets as the `send` of an `emit` channel (a window, a view,
contents or a frame) and returns a promise of what the responder returns. The request carries a
correlation ID, and the renderer answers on a reply channel, named like the channel with `:reply`
behind it, with the same ID. The reply counts only when it comes from the contents (and the frame)
that were asked, so another renderer cannot answer for them, and only the first reply counts.

The promise rejects with an `IpcAskError`, which has the `channel` and a `code`:

| `code`                | When                                                                       |
|-----------------------|----------------------------------------------------------------------------|
| `IPC_ASK_TIMEOUT`     | the renderer has not answered within `timeoutMs`                           |
| `IPC_ASK_DESTROYED`   | the target is destroyed, its renderer process is gone or crashed, the page that was asked is replaced by a reload or a navigation, or the frame is detached |
| `IPC_ASK_NO_HANDLER`  | the renderer has no responder registered, such as before the page has loaded it |
| `IPC_ASK_INVALID_REPLY` | the reply is not an answer or an error                                   |

If the responder throws, the promise rejects with an `IpcAskError` which has the `name`, `message`,
`code` and `data` of that error, in the form of the errors of `invoke` channels (see Errors). The
renderer should throw a plain object, `{ name, message, code, data }`, if it wants more than the
message to arrive: `contextBridge` copies an `Error` thrown by the page with its message only. The
`rawErrors` option does not apply to `ask`, since the answers do not travel through Electron's own
`invoke`. A destroyed target and a failing send both reject the promise, and never throw. That includes
a `BrowserWindow` that was destroyed before the question, whose `webContents` getter throws in
Electron: it rejects with `IPC_ASK_DESTROYED` too. Only `ask` promises this; the verbs that return
nothing (`send` of an `emit` channel, and `connect` of the port verbs) throw Electron's own error
for such a window, since the caller handed over a target that is gone.

A question belongs to the document that it was sent to. If that document is replaced before it
answers, the promise rejects with `IPC_ASK_DESTROYED` at once, and does not wait for a timeout: for
contents (or a window, or a view), when a navigation of the main frame commits (`did-navigate`,
which a reload also emits, but a navigation inside the page, such as a change of the hash, does
not); for a frame, when that frame navigates, or when the main frame does, since that replaces every
frame below it (`did-frame-navigate`). The commit is what counts, not the start, so the old page can
still answer while a navigation is pending, and a navigation that `beforeunload` cancels changes
nothing. A question to contents whose renderer has crashed, or to a frame that is destroyed or
detached, rejects at once, without being sent.

There is no timeout unless one is given. To bound the wait, use
`invokeWith(target, { timeoutMs }, ...args)`:

```typescript
const unsaved = await ipc.hasUnsavedChanges.invokeWith(window, { timeoutMs: 3000 }, currentDocument);
```

The options come before the arguments, because the signature may end in optional or rest parameters,
which would swallow trailing options. A `timeoutMs` that is not a non-negative number rejects with a
`TypeError`; `Infinity` waits for ever. A reply that comes after the timeout is ignored. A frame has
no event for its own destruction, so a frame that goes away after the question was sent is detected
through its contents or the timeout, which is why a timeout is worth setting for frames.

A renderer has a single responder per channel. Calling `handle` again replaces the previous one,
and the function that `handle` returns removes only its own responder: the disposer of a replaced
responder does nothing. The preload script listens from the start, so a question that arrives while
no responder is registered is answered with `IPC_ASK_NO_HANDLER` at once, and not left to time out.

#### Streaming results

A `stream` channel sends many results for one call, and the renderer can stop it. Use it for
downloads, exports, long jobs and token streams. The signature takes the arguments of the call and
returns an `AsyncIterable<Chunk>` (or an `AsyncIterableIterator<Chunk>` or an `AsyncGenerator<Chunk>`),
and the handler in the main process is an `async function*`:

```typescript
// schema.ts
exportRows: stream<(table: string, limit?: number) => AsyncIterable<Row>, DatabaseError>(),

// main process: the event comes first, as for the handler of an invoke
ipc.exportRows.handle(async function* (event, table, limit) {
   const cursor = await database.open(table);
   try {
      for await (const row of cursor) {
         yield row;
      }
   } finally {
      await cursor.close(); // also runs when the renderer cancels
   }
});

// renderer
for await (const row of ipc.exportRows.stream("people", 100)) {
   table.append(row);
}
```

Every call gets a `MessageChannelMain` of its own, so the chunks of two calls never mix, and they
arrive in the order that the generator produced them. The page calls `ipc.<name>.stream(...args)`,
which asks the main process through `ipcMain.handle` and returns the stream at once. The main
process hands one port of a new channel to the frame that asked, and sends `chunk` messages over the
other one, then `end` or `error`, and closes it. If the call cannot start, for example because the
sender is not allowed, the arguments are invalid, no handler is registered or the handler throws
before it returns, then the first read of the stream rejects instead.

The stream is an async iterator with one more method, `cancel()`:

```typescript
const stream = ipc.exportRows.stream("people");
const first = await stream.next();  // { done: false, value: row }
stream.cancel();                    // or: await stream.return()
```

`cancel()`, `return()` and the `break` of a `for await` loop stop the stream: the main process calls
`return()` on the generator, so its `finally` blocks run, no chunk is sent after that, and the
chunks that the page has not read yet are dropped. The main process also stops the generator when
the page closes its port, such as when it navigates away, and when its contents are destroyed. A
generator that is waiting for something when the stop arrives is stopped when it next yields, as
`return()` of any async generator is. The generator cannot be interrupted while it waits.

**There is no `AbortSignal` option**, since `contextBridge` copies an `AbortSignal` as an empty
object (checked in Electron 44.7.0), so the preload script cannot listen to it. A page that has a
signal stops the stream itself:

```typescript
const stream = ipc.exportRows.stream("people");
signal.addEventListener("abort", () => stream.cancel(), { once: true });
```

If the generator throws, the chunks that came before the error are read first. Then the read rejects
with the error object of an `invoke` channel, `{ name, message, code?, data? }` (see Errors), and
later reads are `done`. The second type argument documents the error types, in `window.d.ts`, as for
`invoke`, and the `as` form cannot declare them. A chunk that cannot be cloned stops the generator
and fails the stream with `IPC_STREAM_UNSENDABLE`. The other codes are `IPC_STREAM_NOT_ITERABLE` (the
handler did not return an async iterable), `IPC_STREAM_INVALID_REQUEST`, `IPC_STREAM_INVALID_REPLY`,
and `IPC_STREAM_CLOSED`, which a page gets when the port closes before the stream has ended. A stream
always uses this error format, also with `rawErrors`. The types of the chunks are checked against the
structured clone algorithm (see What Can Be Sent).

`allowedOrigins` and `validate` work as they do for `invoke` (see Sender validation). A rejected
call, and one with invalid arguments, fail the first read with `IPC_FORBIDDEN` and `IPC_VALIDATION`,
before the handler runs.

Things to know:

- **A slow reader slows the generator down.** The page grants the main process a window of
  `highWaterMark` chunks that it has not read yet (the default is 1024). The main process stops
  pulling from the generator when the window is used up, and the page grants more as it reads, in
  steps of half a window. A page that stops reading holds at most one window in memory, and the
  generator waits. `cancel()`, `return()`, a closed port and destroyed contents stop a paused
  generator at once, since it is suspended at a `yield`. See Backpressure below.
- A stream starts when `stream(...)` is called, not at the first read.
- A channel has one handler, as for `invoke`: registering `handle` again replaces the previous
  one, and a stream that runs keeps the generator it started with. There is no `handleOnce`.
- A stream is not cut off when a handler is replaced or removed, only when it ends or is cancelled.

##### Backpressure

`highWaterMark` is the most chunks that the generator may be ahead of the page:

```typescript
exportRows: stream<(table: string) => AsyncIterable<Row>>({ highWaterMark: 64 }),
tokens: stream<(prompt: string) => AsyncIterable<string>>({ highWaterMark: Infinity }), // no limit
rows: stream<() => AsyncIterable<Row>>({ highWaterMark: 0 }), // pull-based
```

It is a non-negative integer literal, or `Infinity`. The unit is the chunk, whatever its size, so
use a lower value for large chunks (a window of 1024 chunks of 1 MB is a gigabyte). With `0` the
generator is asked for a chunk only while the page waits for one, which costs a round trip for each
chunk. With `Infinity` nothing is paused and the page sends no credits.
The credits travel over the port of the call, as `{ type: 'credit', limit }` messages from the page,
where `limit` is the total of chunks that the page allows so far. A reader that reads fast sends one
message for half a window of chunks. `streamUtility` channels take the same option, and the window
is per call, though all the streams of a channel share one port.

#### Port channels

A `port` channel connects two windows with a `MessagePort` pair, so they talk without the main
process in between. The main process pairs them, the renderers send and listen:

```typescript
// main process
const connection = ipc.chat.connect(winA, winB); // call connection.close() to end it

// renderer
const stop = ipc.chat.on((msg) => show(msg)); // any number of subscribers, each with a disposer
ipc.chat.send("hi"); // queued until the port has arrived, then sent in order
ipc.chat.onReady(() => console.log("connected")); // for every new port, at once if one is there
ipc.chat.onClose(() => console.log("the connection ended"));
```

`connect` can be called before the windows have loaded: it pairs them as soon as both have, and again
after either of them reloads, so a reloaded page gets a fresh port and the other page switches to
it (`onReady` runs again, `onClose` does not, since the connection goes on). The handle that `connect`
returns has a `close()`, which ends the connection and runs `onClose` in both windows. Destroying
either window ends it as well, for the other window. After the end, `send` queues again until a
new `connect` pairs the windows.

A window can hold any number of connections of a channel, such as a hub with several peers. Call
`connect` once per pair, and the hub gets each peer as a connection object of its own:

```typescript
// main process
for (const peer of peers) {
   ipc.chat.connect(hub, peer);
}

// renderer of the hub
const stop = ipc.chat.onConnection((peer) => {
   peer.send("welcome"); // to this peer alone
   peer.on((msg) => show(msg)); // from this peer alone
   peer.onClose(() => console.log("a peer left"));
   // peer.close() ends the connection for the peer as well
});
```

A connection has `send`, `on`, `onReady`, `onClose` and `close`. `onConnection` runs at once for the
connections that are already there, then for each new peer, and returns a function which removes it.
A peer that reloads is the same connection object with a new port (`onReady` runs again). `close()`
ends the connection for both pages, through the main process, so it does not come back when a page
reloads; `send` of a closed connection does nothing.

The methods of the channel itself, `ipc.chat.send`, `on`, `onReady` and `onClose`, address all of the
connections: `send` goes to each of them (and is queued for the first one while there is none), and
the others hear every connection. They are what a page with a single peer needs.

#### Ports between the main process and a renderer

High-frequency data, such as log tailing, audio meters or progress, pays the overhead of `ipcMain`
for every message. Electron recommends a `MessagePortMain` for it, and a `mainPort` channel
generates one. The signature types the messages in both directions, as it does for `port`:

```typescript
// schema.ts
logTail: mainPort<(line: string) => void>(),

// main process: a window, a view or contents
const tail = ipc.logTail.connect(mainWindow);
tail.send("started"); // queued until the page has the port, then sent in order
const stop = tail.on((line) => console.log("from the page:", line)); // any number of subscribers
tail.onReady(() => console.log("the page is connected")); // for every new port, at once if one is there
tail.onClose(() => console.log("the page is gone"));
tail.close(); // ends the connection for good

// renderer: the API of a `port` channel
ipc.logTail.on((line) => append(line));
ipc.logTail.send("hello"); // to the main process
```

`connect(target)` returns the connection of the main process, a typed wrapper of the `MessagePortMain`
that it keeps: `send`, `on`, `onReady`, `onClose` and `close`. The messages are argument lists, and
the callbacks get the arguments, not the Electron event. The main process keeps one end of a
`MessageChannelMain` and transfers the other to the page once it has loaded, and again after every
reload, so a reloaded page gets a fresh port, `onReady` runs again and `onClose` does not run for the
replaced port. `onClose` runs when the port closes, such as when the page goes away; the connection
then queues `send` until the page is back. `close()` is final. It tells the page, which runs its own
`onClose`, and the connection is not paired again. The connection also ends when the contents are
destroyed, and when the page calls `close()` on its connection.

The renderer has the API of a `port` channel (see above), with the main process as the peer. Several
`connect` calls make several connections, for one or for different contents, and a page gets each of
them from `onConnection`. A channel is either a `port` channel or a `mainPort` channel, not both.

`connect` of both port verbs is given a window or view that must still exist: for one that is
already destroyed, it throws Electron's own `TypeError: Object has been destroyed`, before it registers anything: a failed `connect` leaves no listener, entry or watch behind, so the other window of a `port` channel is not affected. A target that is destroyed later ends the connection, as described above.

#### Bounded send queues

`send` of a `port` or `mainPort` channel queues its messages whenever there is no port to send to:
before the page has loaded, after a port has closed while the contents are still alive, and, for
the channel itself, while it has no connection yet. A main process that tails a log into a window
which has not loaded would otherwise hold every line in memory, so these queues are bounded:

```typescript
// schema.ts
logTail: mainPort<(line: string) => void>({ maxQueue: 5000 }),
meters: mainPort<(level: number) => void>({ maxQueue: 0 }), // nothing is queued
frames: mainPort<(frame: Uint8Array) => void>({ maxQueue: Infinity }), // never drops
```

`maxQueue` is a non-negative integer literal, or `Infinity`, and the default is 1000. Messages are
counted, not bytes. It applies to every queue of the channel: the queue of each connection in the
preload script, the queue of the channel that waits for the first connection, and, for `mainPort`,
the queue of each connection in the main process. With `0` nothing is queued, and every message
that is sent while there is no port goes through the overflow path below. `Infinity` is a plain
identifier, so a linter with the `useNumberNamespace` rule asks for `Number.POSITIVE_INFINITY`; the
schema does not accept that form, and the rule is best disabled for the line.

A message that does not fit is handled by the overflow callback, and the oldest message is dropped
when there is none. A callback is registered at run time, since the schema is only parsed, never
executed. The page and the main process differ on purpose:

```typescript
// renderer: gets the new message, and answers with an action
const stop = ipc.logTail.onOverflow((message, info) => {
   // message: the argument list, [line]
   // info: { channel: "logTail", max: 5000, dropped: 12, warnings: 1 }
   return "dropOldest"; // or "dropNewest", or "clear" (drop the queue, keep the new message)
});
connection.onOverflow(callback); // on a connection from onConnection: wins over the channel's callback

// main process: gets the queue, and returns the messages to keep
configurePorts({
   onOverflow: (queue, message, info) => [...queue.slice(1), message], // the default of all channels
});
tail.onOverflow((queue, message, info) => [...queue, message]); // for one connection only
tail.onOverflow(undefined); // back to the global callback
```

The page callback never gets the queue, because `contextBridge` copies every argument that crosses
it, and a queue at its limit would be copied again for every message that is dropped. The main
process has no bridge, so its callback gets a copy of the queue (each message is an argument list)
and returns the array to keep, which covers dropping the oldest or the newest, coalescing and
clearing. If it returns more than `maxQueue` messages, the oldest are dropped to fit. A callback that
throws, or returns something else, is logged with `console.error` and the oldest message is dropped.
`info.dropped` and `info.warnings` count what this queue has dropped and warned about so far.

The first drop of a queue is logged with `console.warn`, and then every 100th (100, 200, ...). The
text names the channel and `maxQueue`, and gives the counts. The counts belong to the queue and are
never reset, so a queue that drains and overflows again continues them. `configurePorts` is
generated when the schema has a `mainPort` channel; a `port` channel queues only in the preload
script.

#### Sender validation

By default, any frame of any window can call every `invoke` and `send` channel, iframes and child
windows included. Restrict a channel to the origins that you trust with `allowedOrigins`:

```typescript
export default defineChannels({
   readSecret: invoke<(id: number) => Promise<string>>({
      allowedOrigins: ["app://.", "http://localhost:5173"],
   }),
});
```

An origin is a scheme, a host and an optional port, in lower case, without a path, a wildcard or
credentials. The generated main bindings compare it for equality with `event.senderFrame.origin`,
never as a prefix, so `http://localhost:5173.attacker.com` does not match. A call without a frame
(`senderFrame` is `null` once the frame is gone) is always rejected.

For rules that depend on more than the origin, call `configureIpc` once at start-up. Its
`validateSender` runs for every `invoke` and `send` channel, in addition to `allowedOrigins`:
a call needs to pass both. A validator which throws or returns anything but `true` rejects the call.

```typescript
import { configureIpc, IpcForbiddenError } from "./main";

configureIpc({
   validateSender: (event, channel) => event.sender === mainWindow.webContents,
   onRejected: (event, channel) => console.warn("Rejected", channel, event.senderFrame?.url),
});
```

A rejected `invoke` throws an `IpcForbiddenError` in the main process, which the renderer sees as
a rejected promise (Electron passes on the message of the error only). A rejected `send` is
dropped. `onRejected` is called for both. `configureIpc` replaces the previous configuration, and
`configureIpc({})` removes it. Channels with neither `allowedOrigins` nor a validator are not
checked. `once` and `handleOnce` are not used up by a rejected call.

Renderer input is untrusted, and TypeScript types are erased at runtime. To check the arguments of
an `invoke` or `send` channel, give it `validate`: a [Standard Schema](https://standardschema.dev)
(zod, valibot, arktype, ...) of the argument tuple. It must be an identifier which the schema file
imports as a value. A signature stays required, and `validate` is checked against its parameters.

```typescript
import { z } from "zod";
export const getUserArgs = z.tuple([z.number().int().positive()]);
```

```typescript
import { getUserArgs } from "./validators";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>({ validate: getUserArgs }),
});
```

The generated `main.ts` imports `getUserArgs` and runs it on the arguments as they arrived, after
the sender check and before your handler. The handler receives the output of the schema, so a
transforming schema (a default, a coercion, stripped keys) is honored. An invalid `invoke` throws an
`IpcValidationError` with the `issues` of the schema, which the renderer sees as a rejected promise
with the code `IPC_VALIDATION` and the issues as `data` (see [Errors](#errors)). An invalid `send`
is dropped. `onRejected` is called for both
and receives the error as its third argument, an `IpcValidationError` or an `IpcForbiddenError`.
A schema which throws, rejects or answers with anything but an array of arguments counts as a
failure, and the message of such an error is not passed on. A synchronous schema keeps the call
synchronous, an asynchronous one is awaited. `once` and `handleOnce` are not used up by an invalid
call. The generated code does not depend on any validation library.

A channel with an `emit` trigger also has `ipc.<name>.bind(window, provider)` in the main process.
The callbacks of `handle` and `on` receive the Electron event first, then the arguments of the signature.

#### Scopes: a different API per window

By default every window gets every channel. An app with a privileged settings window and a sandboxed
window for content or plugins wants a different API for each. Put a channel in scopes with `scopes`:

```typescript
export default defineChannels({
   // Open to all windows, also to the ones that are in no scope.
   getVersion: invoke<() => Promise<string>>(),
   // The settings window only.
   saveSettings: invoke<(settings: Settings) => Promise<void>>({ scopes: ["settings"] }),
   // The settings window and the editor window.
   notify: send<(text: string) => void>({ scopes: ["settings", "editor"] }),
   openFile: invoke<(path: string) => Promise<string>>({ scopes: ["editor"] }),
});
```

`scopes` is accepted by `invoke`, `send`, `emit`, `ask`, `stream`, `port`, `mainPort`,
`invokeUtility` and `streamUtility`, which are the channels that a page takes part in. A scope name
is made of lower case letters and digits, joined by dashes, and `default` is taken.
The API of a scope is its own channels and the ones without `scopes`.

**One preload script and one declaration file per scope.** `ipcgen` writes `preload.<scope>.ts` and
`window.<scope>.d.ts` next to the usual files, here `preload.settings.ts`, `window.settings.d.ts`,
`preload.editor.ts` and `window.editor.d.ts`. The usual `preload.ts` and `window.d.ts` are the API of
a window that is in no scope, so they have only the channels without `scopes`: all of them in a schema
that uses no scopes. Use the file of its scope as the preload script of each window, and include only
one `window*.d.ts` in a renderer project, since each of them declares the same global. A scope that
you remove from the schema leaves its old files behind, so delete them by hand.

**The main process admits a call by the scope of the window.** The preload script is only the API of
the page, and a compromised page can call `ipcRenderer` itself, so the generated `main.ts` also
checks. It exports `registerScope` and the type `IpcScope`, and you register each window in its scope:

```typescript
import { registerScope } from "./autoipc/main";

const settings = new BrowserWindow({ webPreferences: { preload: settingsPreload, sandbox: true } });
registerScope(settings, "settings");   // a window, a view or contents
```

A call to an `invoke`, `send` or `stream` channel with `scopes` is admitted only from contents that
are registered in one of them. Others get an `IpcForbiddenError` (an `invoke`, and the start of a
`stream`), or are dropped (a `send`), and `onRejected` of `configureIpc` hears of it, as it does for
`allowedOrigins`. Contents that are in no scope can call the channels without `scopes` only, and
those are open to all windows. The scope is checked first, then `allowedOrigins`, then
`validateSender`, and a call has to pass all of them.

`registerScope` returns a function which removes the registration. The registration is also removed
when the contents are destroyed, and registering the same contents again replaces it. It belongs to
the contents, so every frame of the window has the scope, and `allowedOrigins` still tells them apart.
A scope that the schema does not declare throws a `TypeError`. Only the calls of a page are guarded
in the main process. For `emit`, `ask`, port and utility channels `scopes` decides the API of the
page: you pick the window that you send to or connect, and a window whose preload script lacks the
channel has no listener for it.

#### Errors

Electron reports an error that an `invoke` handler throws to the renderer as the text
`Error invoking remote method 'getUser': Error: not found`. The class, the `code` and any other
field are lost. The generated bindings keep them: the main process answers every `invoke` with
`{ ok: true, value }` or `{ ok: false, error }`, and the renderer's `ipc.<name>.invoke` returns the
value or rejects with the error:

```typescript
class NotFoundError extends Error {
   name = "NotFoundError";
   code = "NOT_FOUND";
   constructor(readonly data: { id: number }) {
      super("User not found");
   }
}

ipc.getUser.handle(async (_event, id) => {
   throw new NotFoundError({ id });
});
```

```typescript
try {
   await ipc.getUser.invoke(7);
} catch (error) {
   // { name: "NotFoundError", message: "User not found", code: "NOT_FOUND", data: { id: 7 } }
}
```

The rejection value is a plain object with `name`, `message`, and, when the thrown error has them,
`code` (a string or a number) and `data`. It is not an `Error` and has no stack, since `contextBridge`
copies a thrown `Error` with only its message and stack, and so loses `name`, `code` and `data`.
Check `error.name` or `error.code` instead of `instanceof`. `data` is copied with the structured
clone algorithm, and is left out when it cannot be cloned (it holds a function, for example). Anything
that is thrown but is not an object, such as a string, becomes the `message`. A call from a sender
that is not allowed, and one with invalid arguments, reject the same way, with the codes
`IPC_FORBIDDEN` and `IPC_VALIDATION`. A call to a channel with no registered handler still fails with
the message of Electron.

Declare the errors that a handler may throw in a second type argument of `invoke`. They are
documented in the generated `window.d.ts`, and the global type `IpcError<E>` describes the object
that the promise is rejected with:

```typescript
export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>, NotFoundError | AuthError>(),
});
```

```typescript
catch (error) {
   const failure = error as IpcError<NotFoundError | AuthError>;
   if (failure.name === "NotFoundError") {
      console.log(failure.data.id); // typed from NotFoundError
   }
}
```

`IpcError` follows the `name`, `code` and `data` types of the declared classes, so give them literal
types, as `NotFoundError` above does with `name = "NotFoundError"`, to tell them apart by `name`. The
`as` form cannot declare error types.

Set `rawErrors` to `true` in the config to turn all of this off: handlers then answer with their value
and Electron reports their errors as it always did.

#### Timeouts

A handler that never answers leaves the promise of `ipc.<name>.invoke` pending for ever. Give a
channel a time limit with `timeoutMs`, or set a default for all `invoke` channels in the config:

```typescript
export default defineChannels({
   exportAll: invoke<() => Promise<string>>({ timeoutMs: 30_000 }),
   // `0` turns the timeout off for this channel, also when the config sets a default.
   waitForUser: invoke<() => Promise<boolean>>({ timeoutMs: 0 }),
});
```

When the time has passed without a reply, the preload script rejects the promise with a plain object,
like the other errors of the library, and `window.d.ts` documents it as `IpcTimeoutError`:

```typescript
catch (error) {
   const failure = error as IpcError<IpcTimeoutError>;
   if (failure.code === "IPC_TIMEOUT") { /* ... */ }
}
```

Only the wait of the page ends. The handler in the main process keeps running, since it cannot be
stopped from the renderer, and its late reply is dropped. The option takes a non-negative integer
literal and applies to `invoke` only: a `send` has no reply, and `ask` has its own `timeoutMs` in
`invokeWith`. With `rawErrors`, the timeout still rejects with this object, while the errors of the
handlers stay Electron's.

The calls to and from a utility process take the same option: `callUtility`, `callMain` and
`invokeUtility` reject with an `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT` (for the page, the
plain object of the same shape), and the default of the config applies to them. A `streamUtility` takes
`timeoutMs` as well, but only as the wait for its first chunk, its end or an error, and the default of
the config does not apply to it: a timed-out stream is cancelled in the child and fails the read of the
page. The handler of a call is not stopped, and its late reply is dropped.

`invokeFromWorker` takes `timeoutMs` too, and the default of the config applies to it. The preload
script of a service worker has no timers (`setTimeout` is not defined there), so the main process times
the call: from the moment it arrives, over the schema of `validate` and the handler. The worker gets the
plain object `{ name: "IpcTimeoutError", message, code: "IPC_TIMEOUT" }`. The handler is not stopped,
and its late reply is dropped. With `rawErrors` the main process still rejects the call, but the worker
gets the error of Electron, and the typings do not declare `IpcTimeoutError`. A question to a worker,
`askWorker`, has no schema option: `invokeWith(worker, { timeoutMs }, ...args)` times it.

#### Utility processes

`utilityProcess` is where Electron wants CPU-heavy or crash-prone work (SQLite, indexing, native
modules), and it only offers untyped `postMessage` and `process.parentPort`. Four verbs type the
traffic between the main process and a utility process, with request and response:

| Verb            | Who calls                  | Main process                    | Utility process                  |
|-----------------|----------------------------|---------------------------------|----------------------------------|
| `callUtility`   | main, the child answers    | `invoke(child, ...args)`        | `handle(callback)`               |
| `notifyUtility` | main, one way              | `send(child, ...args)`          | `on(callback)`, `once(callback)` |
| `callMain`      | the child, main answers    | `handle(child, callback)`       | `invoke(...args)`                |
| `notifyMain`    | the child, one way         | `on(child, callback)`, `once(child, callback)` | `send(...args)`   |

Besides `main.ts`, the generator writes `utility.ts` (see `utilityBindingsPath`), with the same
`ipc` object for the code that runs in the utility process. It talks over `process.parentPort`, needs
no import from `electron`, and, like the other generated files, no dependency on this library. It is
written only when the schema has such a channel. Import it in the entry file of the child:

```typescript
// main process
import { utilityProcess } from "electron";
import { attachUtility, ipc } from "./autoipc/main";

const child = utilityProcess.fork(path.join(__dirname, "indexer.js"));
attachUtility(child); // optional, see below
ipc.getSetting.handle(child, async (key) => settings.get(key));
ipc.indexed.on(child, (done, total) => console.log(`${done}/${total}`));
ipc.setLogLevel.send(child, "debug");
const count = await ipc.indexFile.invoke(child, "/home/me/notes"); // a number
```

```typescript
// indexer.ts, the entry of the utility process
import { ipc } from "./autoipc/utility";

ipc.indexFile.handle(async (path) => {
   const theme = await ipc.getSetting.invoke("theme");
   return scan(path, theme);
});
ipc.setLogLevel.on((level) => setLevel(level));
```

Every `child` is a `UtilityProcess`, so any number of children can run, each with its own handlers,
listeners and pending calls. The generated code keeps its state per child.

The messages are plain objects with an `__ipc` field, so other messages on the same port are left to the
application. A call has an ID, and the answer is the same envelope as that of an `invoke` channel. A
call is rejected with an `IpcUtilityError`, which `main.ts` and `utility.ts` both export. It is a
real `Error`, since these ends are Node processes: `contextBridge` is not involved. It has the `name`,
`message`, `code` and `data` of what the handler threw, and `channel`. The library uses these codes:

| Code                       | Meaning                                                                       |
|----------------------------|-------------------------------------------------------------------------------|
| `IPC_UTILITY_EXITED`       | the utility process exited, also while the call was pending, and any later call or send |
| `IPC_UTILITY_NO_HANDLER`   | the other side has no handler for the channel                                 |
| `IPC_UTILITY_UNSENDABLE`   | the arguments or the result cannot be cloned (a function, for example)       |
| `IPC_UTILITY_INVALID_REPLY`| the reply had an unknown shape                                                |

A few things to know:
 - A handler is registered per child in the main process, and replaces the previous one. Each `handle`,
   `on` and `once` returns a function which removes that registration. A listener that throws or
   rejects is reported to `console.error`, and the others still run.
 - The code of the child sets up its listener on `process.parentPort` when a channel is first used, and
   Electron queues the messages until then. A call for a channel without a handler is answered with
   `IPC_UTILITY_NO_HANDLER`, so register the handlers when the process starts. The main process
   starts listening to a child when a channel first uses it. A child which calls the main process
   first would not be answered until then, so `attachUtility(child)` starts it right after `fork`.
 - The errors of `invoke` use the envelope also with `rawErrors`, since there is no Electron behavior
   to leave them to. There are no `allowedOrigins`, `validate` or `timeoutMs` options yet: both
   ends are your own code. A call whose handler never answers waits until the process exits.
 - `utility.ts` fails with a `TypeError` when a channel is used outside a utility process. Importing it
   elsewhere is harmless.
 - The signature is checked for what structured clone cannot send, like the others.

#### Calling a utility process from a renderer

A page that needs the database of a utility process would otherwise hop through the main process for
every query. `invokeUtility` and `streamUtility` let the page talk to the child directly: the main
process only brokers a `MessageChannelMain` between a window and the child, and sees none of the
traffic afterwards.

```typescript
// main process
const child = utilityProcess.fork(path.join(__dirname, "indexer.js"));
const win = new BrowserWindow({ webPreferences: { preload } });
const link = ipc.queryRows.connect(child, win); // a window, a view or contents
ipc.scanRows.connect(child, win);
// Later, to end the connection: link.close()
```

```typescript
// indexer.ts, the entry of the utility process
import { ipc } from "./autoipc/utility";

ipc.queryRows.handle(async (sql) => db.all(sql));
ipc.scanRows.handle(async function* (table) {
   for (const row of db.iterate(table)) {
      yield row;
   }
});
```

```typescript
// renderer
const rows = await ipc.queryRows.invoke("select * from notes");
for await (const row of ipc.scanRows.stream("notes")) {
   render(row);
}
```

The page API is that of `invoke` and `stream`, and the types of `window.d.ts` declare the errors: the
optional second type argument of the verbs lists the error types of the handler, like it does for
`invoke`. A failure reaches the page as a plain object `{ name, message, code?, data? }`. The library
adds an `IpcUtilityError` with these codes:

| Code                       | Meaning                                                                       |
|----------------------------|-------------------------------------------------------------------------------|
| `IPC_UTILITY_EXITED`       | the connection closed (the child exited, `close()` was called, or the port was replaced), also while the call or the stream was open, and any later call |
| `IPC_UTILITY_NO_HANDLER`   | the child has no handler of this kind for the channel                         |
| `IPC_UTILITY_NOT_ITERABLE` | the handler of a stream returned something that is not an async iterable      |
| `IPC_UTILITY_UNSENDABLE`   | the arguments, the result or a chunk cannot be cloned                         |
| `IPC_UTILITY_INVALID_REPLY`| the reply had an unknown shape                                                |

A few things to know:
 - There is one port per channel and page, and `connect(child, target)` is how the main process
   chooses the child that serves a channel, and the pages that may use it. A page cannot reach a
   channel that was not connected to it, and a port serves only the channel it was made for.
   Connecting the same channel to the same page again replaces the earlier connection.
 - The port is posted once the page has loaded, and again on every load, so a page that reloads gets a
   fresh port. A call made before the port is there waits for it, in order. The connection ends when
   `close()` is called, when the child exits and when the contents are destroyed. After that, calls
   are rejected with `IPC_UTILITY_EXITED` until the main process connects again, such as to a new child.
 - All the calls and streams of a channel share its port and are told apart by an ID. Cancelling a
   stream (`cancel()`, `return()` or a `break`) and closing the connection stop the generator in the
   child. The generator is slowed down for a page that reads slowly, with `highWaterMark` as for
   `stream` (the default is 1024 chunks, per call).
 - The handler of the child is single, as for `callUtility`: a new `handle` replaces the old one, and
   the function it returns removes only its own. Register the handlers when the process starts, since a
   call for a channel without a handler is answered with `IPC_UTILITY_NO_HANDLER`.
 - There are no `allowedOrigins`, `validate` or `timeoutMs` options yet. The main process decides which
   pages are connected, and a call whose handler never answers waits until the connection closes.

#### Service workers

A service worker can need the main process for what it cannot do itself, such as a token that only the
main process holds. Electron 35 added the IPC for it (`ServiceWorkerMain`, `session.serviceWorkers` and a
preload script of the type `service-worker`), and marks it experimental. Four verbs type it:

| Verb               | Who calls                       | Main process                                 | Service worker                    |
|--------------------|---------------------------------|----------------------------------------------|-----------------------------------|
| `invokeFromWorker` | the worker, main answers        | `handle(session, callback)`, `handleOnce`    | `invoke(...args)`                 |
| `sendFromWorker`   | the worker, one way             | `on(session, callback)`, `once`              | `send(...args)`                   |
| `askWorker`        | main, the worker answers        | `invoke(worker, ...args)`, `invokeWith`      | `handle(callback)`                |
| `emitToWorker`     | main, one way                   | `send(worker, ...args)`, `broadcast(session, ...args)` | `on(callback)`, `once(callback)` |

Besides `main.ts`, the generator writes the preload script of the worker, `service-worker-preload.ts`,
and its typings, `service-worker.d.ts` (see `serviceWorkerPreloadPath`). They are written only when the
schema has such a channel. The preload script is the one of a page for these channels: it is sandboxed
and context isolated, and exposes the API to the code of the worker through `contextBridge`, under the
name `exposeAs`. The page files leave these channels out. Register the script with the session, and
include the typings in the project that compiles the worker, which has its own `tsconfig.json`: the
typings declare the same global variable as `window.d.ts` does, so a project includes only one of them.

```typescript
// main process
import { app, session } from "electron";
import { attachServiceWorkers, ipc } from "./autoipc/main";

app.whenReady().then(() => {
   const ses = session.defaultSession;
   // The compiled service-worker-preload.ts, as an absolute path.
   ses.registerPreloadScript({ type: "service-worker", filePath: path.join(__dirname, "sw-preload.js") });
   attachServiceWorkers(ses); // optional, see below

   ipc.getToken.handle(ses, async (event, scope) => tokens.get(scope));
   ipc.syncDone.on(ses, (event, pending) => console.log(event.versionId, pending));
});

// Later, to talk to a worker:
const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId); // a ServiceWorkerMain
ipc.configChanged.send(worker, "theme");
ipc.configChanged.broadcast(ses, "theme"); // all the workers of the session that run
const flushed = await ipc.flushQueue.invoke(worker, true); // a number
```

```typescript
// sw.ts, the service worker (compiled with service-worker.d.ts)
const token = await ipc.getToken.invoke("app");
ipc.syncDone.send(0);
ipc.flushQueue.handle(async (force) => queue.flush(force));
ipc.configChanged.on((key) => reloadConfig(key));
```

A worker starts and stops on its own, and its messages go to the `ipc` of its `ServiceWorkerMain`, never
to `ipcMain`. So the generated code keeps one hub per `Session`. It watches `session.serviceWorkers`, and routes every channel
that a worker calls to the callbacks of the session as each worker starts, before the worker can send from
its preload script. `handle` and `on` take the `Session` instead of a worker for that reason: a callback
is there for every worker of the session, also for one that starts later, and its disposer removes only
that registration. A channel has one handler, and a new `handle` replaces it, as for `invoke`.
`attachServiceWorkers(session)` starts the hub without a registration. Call it before the first worker
starts if the main process only asks (`askWorker`) or sends to workers, since `invoke(worker, ...)` needs
the hub to know the worker. Otherwise it rejects with `IPC_ASK_NOT_ATTACHED`.

What the worker sends is as untrusted as what a page sends, and the events of a worker are not those of
a frame: `IpcMainServiceWorkerEvent` and `IpcMainServiceWorkerInvokeEvent` have `versionId`,
`serviceWorker` (with `scope` and `scriptURL`) and `session`, and no `senderFrame`. So:
 - `allowedOrigins` of `invokeFromWorker` and `sendFromWorker` is compared for equality with the origin of
   the scope of the worker (`app://main` for the scope `app://main/`, `http://localhost:5173`). Pages
   register workers of their own origin only, so this is the origin that may use the channel.
 - `configureServiceWorkerIpc({ validateSender, onRejected })` is the hook of the workers, like
   `configureIpc` is for pages. `validateSender(event, channel)` sees the event with `versionId` and
   `serviceWorker.scope`, and only `true` allows the call. The hooks of pages are not changed.
 - `validate` of `invokeFromWorker` and `sendFromWorker` is a Standard Schema of the argument tuple,
   exactly as for `invoke` and `send` (see [Sender validation](#sender-validation)). It runs after the
   sender check and before the callback, which gets the output of the schema. An invalid call is rejected
   with an `IpcValidationError`, which reaches the worker as the plain object
   `{ name, message, code: "IPC_VALIDATION", data }`, and an invalid message is dropped. When a channel
   has a validator, `onRejected` gets the error as its third argument: an `IpcValidationError`, or an
   `IpcWorkerError` for a call that the sender check rejected. A call for a channel without a handler,
   and a message without a listener, are not validated. `handleOnce` and `once` are used up by the first
   valid call, also when the schema is asynchronous.
 - A call that is rejected throws an `IpcWorkerError` with the code `IPC_WORKER_FORBIDDEN`, which reaches
   the worker as the plain object `{ name, message, code }`. A message that is rejected is dropped. A call
   for a channel without a handler is answered with `IPC_WORKER_NO_HANDLER`.

Errors and answers work as they do for the other channels:
 - The handler of `invokeFromWorker` answers with the envelope of `invoke`: a value, or the `name`,
   `message`, `code` and `data` of what it threw, as a plain object, since `contextBridge` does not keep
   the fields of an `Error`. The optional second type argument lists the error types, which the
   typings declare as `IpcError`. With `rawErrors` the errors stay Electron's.
 - `askWorker` is an `ask` channel with a worker as the target. The question carries an ID, the worker
   answers on a reply channel, and the promise is rejected with an `IpcAskError`: with the error of the
   responder, `IPC_ASK_TIMEOUT` (`invokeWith(worker, { timeoutMs }, ...args)`, as for `ask`),
   `IPC_ASK_NO_HANDLER`, `IPC_ASK_INVALID_REPLY`, and `IPC_ASK_DESTROYED` when the worker stops. A
   responder that wants its `code` and `data` to arrive rejects with a plain object, as for `ask`. A
   question keeps the worker alive with `startTask` until it is answered, so an idle worker does not stop
   while it is asked. Only the worker that was asked can answer.
 - `send(worker, ...args)` throws an `IpcWorkerError` with `IPC_WORKER_DESTROYED` for a worker that is
   gone. `broadcast(session, ...args)` sends to the workers of the session that run and skips the others.
   Listeners of `sendFromWorker` that throw are reported to `console.error`, and the others still run.
 - A stopped worker loses its state with the next start: register the responders and listeners of the
   worker at the top of its script, as it runs on every start.
 - `invokeFromWorker` has `timeoutMs` (see [Timeouts](#timeouts)). There is no `scopes` option: a worker
   is not a window. The signature is checked for what structured clone cannot send, like the others.

#### Migrating from 0.2

The generated names changed in 1.0.0. The `listeners` option is gone as well: to have several
subscribers, call `.on()` more than once.

| 0.2                                       | 1.0                                  |
|-------------------------------------------|--------------------------------------|
| `import { ipcMain } from "./main"`        | `import { ipc } from "./main"`       |
| `ipcMain.onGetUser(cb)` (`invoke`)        | `ipc.getUser.handle(cb)`             |
| `ipcMain.onEchoUserName(cb)` (`send`)     | `ipc.echoUserName.on(cb)`            |
| `ipcMain.sendProgress(win, n)`            | `ipc.progress.send(win, n)`          |
| `ipcMain.bindProgress(win, provider)`     | `ipc.progress.bind(win, provider)`   |
| `ipcMain.ports.chat.propagate(winA, winB)`| `ipc.chat.connect(winA, winB)`       |
| `window.ipc.sendGetUser(id)` (`invoke`)   | `ipc.getUser.invoke(id)`             |
| `window.ipc.sendEchoUserName(name)` (`send`) | `ipc.echoUserName.send(name)`     |
| `window.ipc.onProgress(cb)`               | `ipc.progress.on(cb)`                |
| `window.ipc.ports.chat.sendMessage(...)`  | `ipc.chat.send(...)`                 |
| `window.ipc.ports.chat.onMessage(cb)`     | `ipc.chat.on(cb)`                    |
| `interface Window { ipc: {...} }` and `export default Window` in `window.d.ts` | `declare global { var ipc: IpcApi }` |

`window.ipc` keeps working, since `ipc` is a global variable.

Channel names on the wire now start with `autoipc:`. This changes nothing in the generated API, but
other code that talks to a channel by its raw name, such as a handler registered with `ipcMain`
directly, must use the prefixed name, or set `channelPrefix` to `""`.

An `invoke` that fails now rejects with the error object described in [Errors](#errors), not with an
`Error` whose message is Electron's `Error invoking remote method`. Code that reads that message
needs to read `error.message`, which now holds the message of the handler's error. Set `rawErrors` to
keep the old behavior.


### What Can Be Sent

Arguments and results travel by the structured clone algorithm. `ipcgen` checks every signature
against it, so a mistake is found when the bindings are generated and not when the channel is used:

- A **function type**, `Function`, `symbol`, `WeakMap` or `WeakSet` in a parameter or a return type
  is an error, and so is a `Promise` in a parameter. Electron throws `An object could not be cloned`
  for them. The check looks inside arrays, tuples, unions, object members, type arguments, type
  parameter constraints, and the aliases, interfaces and generic types of the schema file.
  Send plain data instead, and use a channel to call back.
- An instance of a **class declared in the schema file** is a warning: it arrives as a plain
  object without its prototype and methods. Use an interface or a type alias for the data, or
  configure a [custom serializer](#custom-serializers) that revives the class.

The result of an `invoke` channel may be a `Promise`, since that is how it is awaited. The same checks
apply to the type of the chunks of a `stream` channel, not to the iterable that the signature returns. Types that
come from other files, `typeof` queries and the results of utility types such as `Omit` or
`Exclude` are not followed, so they are never reported.


### Custom serializers

Electron clones the arguments and results with the structured clone algorithm. A `Map`, a `Set`, a
`Date` and a `bigint` survive it, but a class instance loses its prototype, and a value such as a
`URL` or an `undefined` member of a union gets lost or changed. The `serializer` option of the config
names a module that turns the values into something that survives, and back:

```json
{ "config": { "autoipc": { "serializer": "superjson" } } }
```

```ts
// A path from the project root works as well: "serializer": "./src/wire.ts"
export function serialize(value: unknown): unknown { /* ... */ }
export function deserialize(wire: unknown): unknown { /* ... */ }
```

The module must export `serialize` and `deserialize` by these names, in the shape of
[superjson](https://github.com/flightcontrolhq/superjson): what `serialize` returns must be cloneable
by Electron (`{ json, meta }` is), and `deserialize` takes it back. Both are synchronous. The generated
`main.ts` and `preload.ts` import the module, so a sandboxed preload script needs a bundler that
inlines it, as it does for any import. The module is not part of the generated files, and the generated
code has no dependency on this library at runtime.

The serializer applies to the channels between a page and the main process: the arguments and the
result of `invoke`, the arguments of `send` and `emit`, the arguments and the answer of `ask`, and the
arguments and the chunks of `stream`. The arguments of a call travel as one value, the list of them.
It applies to `port` and `mainPort` channels as well, at both ends, whether the other end is another
page or the main process: a message is posted as a list of one value, the list of the arguments as the
serializer made it. The main process only pairs the pages of a `port` channel and sees none of their
messages, so its file does not import the serializer for that channel.
It applies to the channels of utility processes as well, at both ends, in `main.ts`, in `utility.ts` and
in the preload script: the arguments and the result of `callUtility` and `callMain`, the arguments of
`notifyUtility` and `notifyMain`, and, over the brokered port, the arguments and the result of
`invokeUtility` and the arguments and the chunks of `streamUtility`. They travel as they do between a
page and the main process: the arguments of a call as one value, the list of them. The main process only
brokers the port between a page and a utility process and sees none of its messages, so its file does not
import the serializer for `invokeUtility` and `streamUtility`.
It applies to the channels of service workers as well, in `main.ts` and in `service-worker-preload.ts`:
the arguments and the result of `invokeFromWorker`, the arguments of `sendFromWorker` and `emitToWorker`,
and the arguments and the answer of `askWorker`. They travel like the channels of a page: the arguments
of a call or a message as one value, the list of them. The preload script of a worker is sandboxed, so it
needs a bundler that inlines the serializer module, as the preload script of a page does.
It does not apply to the `data` of an error, which is cloned as before.

- **Order.** The main process checks the sender first, then deserializes, then runs the `validate`
  schema on the deserialized arguments. A message from a sender that is rejected never reaches the
  code of the serializer. This holds for a service worker as well: `validateSender` and `allowedOrigins`
  come first.
- **Failures.** A value that cannot be serialized fails the call: an `invoke` or a `stream` rejects,
  and a `send` throws, in the page. The rejection is the plain object `{ name: 'IpcSerializationError',
  message, code: 'IPC_SERIALIZATION' }`. What a function throws synchronously reaches the page as an
  `Error` with the message only, since `contextBridge` copies it that way, so a `send` throws an `Error`
  whose message begins with the code: `[IPC_SERIALIZATION] The data cannot be serialized of the channel
  '...': ...`. The page tells the failure by that prefix, and there is no `code` or `name` to read.
  In the main process the same failure throws an `IpcSerializationError`
  (exported from `main.ts`), also with the code `IPC_SERIALIZATION`; for a call from the page it reaches
  the page in the error envelope. A message that cannot be deserialized is answered with that error if
  someone waits for an answer, and otherwise (`send`, `emit`) it is logged with `console.error` and
  dropped, so it is not an uncaught error of the main process. A chunk of a stream that cannot be read
  fails the stream. On a port channel, a `send` throws when its message cannot be serialized and a port
  is there. A message that waits in the queue for a port is serialized when the queue is flushed, so one
  that cannot be is logged with `console.error` and dropped, and the others go on. A message that arrives
  and cannot be deserialized is logged and dropped as well.
  For a utility process, a call whose arguments cannot be serialized rejects, and a `send` throws, with
  an `IpcSerializationError` in `main.ts` and in `utility.ts` (both export the class); in the page it is
  the plain object, as above. A call that arrives with arguments that cannot be read, or whose result
  cannot be serialized, is answered with the error envelope, so the caller rejects with an
  `IpcUtilityError` that has the `name` `IpcSerializationError` and the `code` `IPC_SERIALIZATION`. A
  reply that cannot be deserialized rejects the call with an `IpcSerializationError`. A `send` that
  arrives and cannot be read is logged with `console.error` and dropped, and a `once` listener is not used
  up by it. A stream whose arguments cannot be read, or one of whose chunks cannot be serialized in the
  child, fails with the error; a chunk that the page cannot deserialize fails the stream there and
  cancels it in the child.
  For a service worker, a call from the worker whose arguments cannot be serialized rejects, and a
  `send` throws, in the worker, an `Error` whose message begins with the code, as above. A call that arrives with arguments that
  cannot be read, or whose result cannot be serialized, is answered with the error envelope (or rejects
  with the `IpcSerializationError`, with `rawErrors`). A message of the worker that cannot be read is
  logged with `console.error` and dropped in the main process, and does not use up a `once` listener, and
  a message to the worker that cannot be read is dropped there. Toward the worker, a question or a
  message that cannot be serialized rejects or throws an `IpcSerializationError` in the main process, and
  nothing is sent. A question the worker cannot read is answered with the error envelope, so the question
  rejects with an `IpcAskError` that carries the `name` and the `code` of the error; an answer the main
  process cannot deserialize rejects it with the code `IPC_ASK_INVALID_REPLY`.
- **The utility file.** `utility.ts` imports the serializer module like `main.ts` does: a package name
  stays as it is, and a path from the project root becomes a path relative to `utility.ts`. A utility
  process is a Node process with Node's module resolution, not a sandbox, so a package resolves from the
  place of the file. Build `utility.ts` and the serializer module for the child the way you build the
  rest of the child (the same bundler config as for `main.ts`), so that the package or the TypeScript path
  is there when the process starts. The child and the main process must use the same serializer module.
- **`contextBridge`.** The page and the preload script are separate worlds. The values that your
  serializer revives in the preload script reach the page through `contextBridge`, which copies them
  again: a `Date`, a `Map` and a `Set` stay what they are, a class instance becomes a plain object
  again. A serializer that revives classes helps the main process, and the page only for the types that
  `contextBridge` carries.
- **Both ends.** All the code that talks to the channel must agree. A page that was built without the
  serializer cannot talk to a main process that has it. Turn it on for the whole project.
- **Types.** The types in `window.d.ts` and in the signatures are those of the schema, as before: the
  signature says `Date`, and the page gets a `Date`.


### The `as` Form

The signature can also be written after the call with `as`. It is an alternative to the type argument,
and the two cannot be combined on one channel:

```typescript
export default defineChannels({
   getUser: invoke() as (id: number) => Promise<User>,
   progress: emit({ trigger: "focus" }) as (n: number) => void,
});
```

What it loses: the type argument form lets TypeScript check the config against the signature,
and it is the only form which can declare error types. In the `as` form the config is not checked
against the signature.

### Development

```bash
bun install
bun run check                 # tsc and biome
bunx vitest run               # the whole suite
bun run test:electron         # only the tests that run in a real Electron
```

Most tests load the generated files against a fake `electron` module. The tests in
`tests/test_electron/` run them in the `electron` binary the repo depends on, in hidden windows with
`sandbox: true` and `contextIsolation: true`, so that `contextBridge`, `senderFrame`, `MessagePort`
transfer and the sandboxed preload script are the real ones. They need:

- **The Electron binary.** `bun install` does not run the postinstall script of `electron`, so run
  `node node_modules/electron/install.js` once.
- **A display.** On Linux without `$DISPLAY` the tests start Electron under `xvfb-run -a`, so install
  `xvfb` (`apt-get install xvfb`). macOS and Windows need nothing.
- **`ELECTRON_NO_SANDBOX=1`** where Chromium's sandbox helper cannot run, such as in a container as
  root (the tests add the flag by themselves for root) or on a CI image whose kernel forbids it. It
  turns off the helper only; the windows still use `sandbox: true`.

Without the binary or a display these tests are skipped, and `bunx vitest run` stays green. With
`REQUIRE_ELECTRON=1`, which CI sets, they fail instead, so a broken setup cannot pass unnoticed.
