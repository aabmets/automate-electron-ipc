// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the argument validation has the wrong types.
import { configureIpc, IpcValidationError, ipc } from "./main";

configureIpc({
   onRejected: (event, channel, error) => {
      console.warn(event.senderFrame?.url, channel, error.message);
      if (error instanceof IpcValidationError) {
         console.warn(
            error.channel,
            error.issues.map((issue) => issue.message),
         );
      }
   },
});

ipc.getSecret.handle((_event, id: number) => Promise.resolve(`secret ${id}`));
ipc.logLine.on((_event, text: string, ...rest: number[]) => console.log(text, rest));
