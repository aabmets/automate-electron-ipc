import type { ServiceWorkerMain, Session } from "electron";
import { attachServiceWorkers, configureServiceWorkerIpc, IpcWorkerError, ipc } from "./main";
import type { SyncState, Token } from "./schema";

// The main process: handlers and listeners are registered per session.
export function setUp(session: Session, worker: ServiceWorkerMain): void {
   attachServiceWorkers(session);
   configureServiceWorkerIpc({
      validateSender: (event, channel) => event.versionId >= 0 && channel.length > 0,
      onRejected: (event, channel) => console.warn(event.serviceWorker.scope, channel),
   });

   const offToken: () => void = ipc.getToken.handle(session, (event, scope, force) => {
      const versionId: number = event.versionId;
      const url: string = event.serviceWorker.scriptURL;
      const token: Token = { value: `${scope}:${versionId}:${url}:${force}`, expires: 1 };
      return Promise.resolve(token);
   });
   offToken();
   ipc.getToken.handleOnce(session, () => Promise.resolve({ value: "x", expires: 0 }));

   ipc.saveBlob.handle(session, (_event, name, ...chunks) => name.length + chunks.length);
   ipc.echo.handle(session, (_event, value) => value);
   ipc.syncDone.on(session, (_event, state) => {
      const pending: number = state.pending;
      console.log(pending);
   });
   const offLog: () => void = ipc.log.once(session, (_event, level, message) => {
      console.log(level, message);
      return Promise.resolve();
   });
   offLog();

   // The questions to a worker are typed by the signature, and the answer is a promise.
   const flushed: Promise<number> = ipc.flushQueue.invoke(worker, true);
   const timed: Promise<number> = ipc.flushQueue.invokeWith(worker, { timeoutMs: 500 }, false);
   const described: Promise<SyncState> = ipc.describe.invoke(worker);
   console.log(flushed, timed, described);

   ipc.configChanged.send(worker, "theme", { dark: true });
   ipc.configChanged.broadcast(session, "theme", 1);
   ipc.goOffline.send(worker);
   ipc.goOffline.broadcast(session);

   const error: IpcWorkerError = new IpcWorkerError("echo", "message", "IPC_WORKER_FORBIDDEN");
   console.log(error.code, error.channel);

   // @ts-expect-error: a worker, not a window, is the target of a question
   ipc.flushQueue.invoke({} as Electron.BrowserWindow, true);
   // @ts-expect-error: the handler of a worker call needs a session
   ipc.getToken.handle(() => Promise.resolve({ value: "x", expires: 0 }));
   // @ts-expect-error: a wrong argument type
   ipc.flushQueue.invoke(worker, "yes");
}
