import type { Session } from "electron";
import { configureServiceWorkerIpc, IpcValidationError, IpcWorkerError, ipc } from "./main";

export function setUp(session: Session): void {
   configureServiceWorkerIpc({
      onRejected: (event, channel, error) => {
         const version: number = event.versionId;
         const reason: IpcWorkerError | IpcValidationError = error;
         if (error instanceof IpcValidationError) {
            const first: string | undefined = error.issues[0]?.message;
            console.log(version, channel, first, error.data);
         } else {
            console.log(version, channel, reason.code);
         }
      },
   });

   // The callback gets the validated arguments, typed by the signature.
   ipc.getToken.handle(session, (_event, scope) => Promise.resolve(scope.toUpperCase()));
   ipc.reportState.on(session, (_event, pending) => {
      const count: number = pending;
      console.log(count);
   });
   ipc.slowStatus.handle(session, () => Promise.resolve("up"));
}
