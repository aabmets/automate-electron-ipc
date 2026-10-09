import type { SyncState, Token } from "./schema";

// The code of the service worker: the preload script exposes the API as a global.
export async function inWorker(): Promise<void> {
   const token: Token = await ipc.getToken.invoke("app", true);
   const size: number = await ipc.saveBlob.invoke("blob", "a", "b");
   const echoed: string = await ipc.echo.invoke("x");
   ipc.syncDone.send({ pending: 0 });
   ipc.log.send("info", "hello");
   console.log(token.value, size, echoed);

   const offFlush: () => void = ipc.flushQueue.handle((force) => (force ? 1 : 0));
   offFlush();
   ipc.describe.handle((): Promise<SyncState> => Promise.resolve({ pending: 1 }));

   const offConfig: () => void = ipc.configChanged.on((key, value) => {
      console.log(key.length, value);
   });
   offConfig();
   ipc.goOffline.once(() => undefined);

   try {
      await ipc.getToken.invoke("app");
   } catch (error) {
      const failure = error as IpcError<Error & { code: "NOT_SIGNED_IN" }>;
      console.log(failure.code);
   }

   // @ts-expect-error: the worker calls the main process, it does not handle the call
   ipc.getToken.handle(() => Promise.resolve({ value: "x", expires: 0 }));
   // @ts-expect-error: a wrong argument type
   ipc.saveBlob.invoke(1);
   // @ts-expect-error: a page channel is not in the API of the worker
   ipc.getUser.invoke(1);
}
