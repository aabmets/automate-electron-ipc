# Service workers

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
and its typings, `service-worker.d.ts`, next to it (see `serviceWorkerPreloadPath`). They are written
only when the schema has such a channel. The preload script is the one of a page for these channels: it is sandboxed
and context isolated, and exposes the API to the code of the worker through `contextBridge`, under the
name `exposeAs`. The page files leave these channels out. Register the script with the session, and
include the typings in the project that compiles the worker, which has its own `tsconfig.json`: the
typings declare the same global variable as `window.d.ts` does, so a project includes only one of them.

<!-- readme-example: kind-service-worker src/autoipc/schema.ts -->
```ts
import {
   askWorker,
   defineChannels,
   emitToWorker,
   invokeFromWorker,
   sendFromWorker,
} from "automate-electron-ipc";

export default defineChannels({
   // The worker asks the main process.
   getToken: invokeFromWorker<(scope: string) => Promise<string>>(),
   // The worker tells the main process something.
   syncDone: sendFromWorker<(pending: number) => void>(),
   // The main process asks the worker.
   flushQueue: askWorker<(force: boolean) => Promise<number>>(),
   // The main process tells the worker something.
   configChanged: emitToWorker<(key: string) => void>(),
});
```

In the main process, register the preload script, and answer the worker. `handle` and `on` take the
session, since a worker starts and stops on its own:

<!-- readme-example: kind-service-worker src/main/index.ts -->
```ts
import path from "node:path";
import { app, session } from "electron";
import { attachServiceWorkers, ipc } from "../autoipc/main";

const tokens = new Map<string, string>();

app.whenReady().then(async () => {
   const ses = session.defaultSession;
   // The compiled service-worker-preload.ts, as an absolute path.
   ses.registerPreloadScript({
      type: "service-worker",
      filePath: path.join(__dirname, "sw-preload.js"),
   });
   attachServiceWorkers(ses); // optional, see below

   ipc.getToken.handle(ses, async (_event, scope) => tokens.get(scope) ?? "");
   ipc.syncDone.on(ses, (event, pending) => console.log(event.versionId, pending));

   // Later, to talk to a worker:
   const worker = ses.serviceWorkers.getWorkerFromVersionID(1); // a ServiceWorkerMain
   if (worker) {
      ipc.configChanged.send(worker, "theme");
      const flushed = await ipc.flushQueue.invoke(worker, true); // a number
      console.log(flushed);
   }
   ipc.configChanged.broadcast(ses, "theme"); // all the workers of the session that run
});
```

The worker is compiled with `service-worker.d.ts`, which declares the global `ipc`, and registers its
responders and listeners at the top of its script:

<!-- readme-example: kind-service-worker src/sw/sw.ts -->
```ts
const queue = { flush: async (_force: boolean) => 0 };

async function start(): Promise<void> {
   const token = await ipc.getToken.invoke("app");
   console.log(token);
   ipc.syncDone.send(0);
}

ipc.flushQueue.handle(async (force) => queue.flush(force));
ipc.configChanged.on((key) => console.log(`reload ${key}`));
start();
```

The main process takes the session for the channels that the worker calls, and the worker for the ones
it answers:

```ts
// main.ts
getToken: {
   handle: (session: Session, callback: (event: IpcMainServiceWorkerInvokeEvent, scope: string) => Promise<string>): (() => void) =>
      registerWorkerHandler(session, 'getToken', callback, false),
   handleOnce: /* the same, and the handler is used up by the first call */,
},
flushQueue: {
   invoke: (worker: ServiceWorkerMain, force: boolean): Promise<number> =>
      askServiceWorker('flushQueue', 'autoipc:flushQueue', worker, [force]) as Promise<number>,
   invokeWith: /* the same, with the options before the arguments */,
},
```

The preload script of the worker is that of a page for these channels. It calls `ipcRenderer.invoke` and
`ipcRenderer.send` itself, and keeps the responder:

```ts
// service-worker-preload.ts
getToken: {
   invoke: async (...args: any[]) => {
      const result = await ipcRenderer.invoke('autoipc:getToken', ...args);
      if (result.ok) {
         return result.value;
      }
      throw result.error;
   },
},
syncDone: {
   send: (...args: any[]) => ipcRenderer.send('autoipc:syncDone', ...args),
},
```

A worker starts and stops on its own, and its messages go to the `ipc` of its `ServiceWorkerMain`, never
to `ipcMain`. So the generated code keeps one hub per `Session`. It watches the
`running-status-changed` event of `session.serviceWorkers`, and routes every channel that a worker
calls to the callbacks of the session as each worker starts, before the worker can send from its
preload script. `handle` and `on` take the `Session` instead of a worker for that reason: a callback
is there for every worker of the session, also for one that starts later, and its disposer removes only
that registration. A channel has one handler, and a new `handle` replaces it, as for `invoke`.
`attachServiceWorkers(session)` starts the hub without a registration. Call it before the first worker
starts if the main process only asks (`askWorker`), since `invoke(worker, ...)` needs the hub to know
the worker. Otherwise it rejects with `IPC_ASK_NOT_ATTACHED`. `send` and `broadcast` of
`emitToWorker` do not use the hub.

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
   exactly as for `invoke` and `send` (see [Sender validation](../security/sender-validation.md)). It runs after the
   sender check and before the callback, which gets the output of the schema. An invalid call is rejected
   with an `IpcValidationError`, which reaches the worker as the plain object
   `{ name, message, code: "IPC_VALIDATION", data }`, and an invalid message is dropped. When a channel
   that a worker calls has a validator, `onRejected` gets the error as its third argument: an `IpcValidationError`, or an
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
   responder, `IPC_ASK_TIMEOUT` (`invokeWith(worker, { timeoutMs }, ...args)`, as for `ask`; a question has no timeout unless
   it is given one, and the default of the config does not apply),
   `IPC_ASK_NO_HANDLER`, `IPC_ASK_INVALID_REPLY`, and `IPC_ASK_DESTROYED` when the worker stops. A
   responder that wants its `code` and `data` to arrive rejects with a plain object, as for `ask`. A
   question keeps the worker alive with `startTask` until it is answered, so an idle worker does not stop
   while it is asked. Only the worker that was asked can answer.
 - `send(worker, ...args)` throws an `IpcWorkerError` with `IPC_WORKER_DESTROYED` for a worker that is
   gone. `broadcast(session, ...args)` sends to the workers of the session that run and skips the others.
   Listeners of `sendFromWorker` that throw are reported to `console.error`, and the others still run.
 - A stopped worker loses its state with the next start: register the responders and listeners of the
   worker at the top of its script, as it runs on every start.
 - `invokeFromWorker` has `timeoutMs` (see [Timeouts](../channels/invoke.md#timeouts)). The preload
   script of a worker has no timers, so the main process times the call. A handler that has not
   answered in time is rejected with `{ name: "IpcTimeoutError", message, code: "IPC_TIMEOUT" }`, the
   handler is not stopped and its late reply is dropped. With `rawErrors` there is no envelope, and
   the worker gets the error of Electron instead. There is no `scopes` option: a worker
   is not a window. The signature is checked for what structured clone cannot send, like the others.

