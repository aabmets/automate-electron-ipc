// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the sender validation has the wrong types.
import { configureIpc, IpcForbiddenError, ipc } from "./main";

configureIpc({});
configureIpc({
   validateSender: (event, channel) =>
      event.senderFrame?.origin === "app://." && channel !== "ping",
   onRejected: (event, channel) => console.warn(event.senderFrame?.url, channel),
});
// @ts-expect-error the validator returns a boolean
configureIpc({ validateSender: () => "yes" });

ipc.getSecret.handle(async (_event, id: number) => `secret ${id}`);
ipc.logLine.on((_event, text: string) => console.log(text));

export const isForbidden = (error: unknown): string | null =>
   error instanceof IpcForbiddenError ? error.channel : null;
