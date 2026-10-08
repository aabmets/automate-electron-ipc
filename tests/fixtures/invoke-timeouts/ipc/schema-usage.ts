// Not a schema: it uses the generated types the way an application would, so that the
// type-check fails when the documented timeout errors are wrong.
import type { NotFoundError } from "./schema";

declare const caught: IpcError<NotFoundError | IpcTimeoutError>;

// The name tells the timeout apart from the declared error.
if (caught.name === "IpcTimeoutError") {
   const code: "IPC_TIMEOUT" = caught.code;
   console.log(code);
} else {
   const code: "NOT_FOUND" = caught.code;
   console.log(code);
}

export const slow: Promise<string> = window.ipc.slow.invoke(1);
export const patient: Promise<string> = window.ipc.patient.invoke();
