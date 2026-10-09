// The code of the worker: the preload script exposes the API as a global.
export async function inWorker(): Promise<void> {
   const token: string = await ipc.getToken.invoke("app");
   const status: string = await ipc.slowStatus.invoke();
   ipc.reportState.send(1);
   console.log(token, status);

   try {
      await ipc.plainStatus.invoke();
   } catch (error) {
      const failure = error as IpcError<IpcTimeoutError>;
      console.log(failure.code);
   }

   // @ts-expect-error: the arguments are typed by the signature
   await ipc.getToken.invoke(1);
}
