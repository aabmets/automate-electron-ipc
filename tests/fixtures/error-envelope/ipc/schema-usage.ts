// Not a schema: it uses the generated types the way an application would, so that the
// type-check fails when the declared error types are wrong.
import type { AuthError, NotFoundError } from "./schema";

declare const caught: IpcError<NotFoundError | AuthError>;

// The name tells the declared errors apart, and each has its own code and data.
if (caught.name === "NotFoundError") {
   const code: "NOT_FOUND" = caught.code;
   const id: number = caught.data.id;
   console.log(code, id);
} else {
   const code: 401 = caught.code;
   const data: unknown = caught.data;
   console.log(code, data);
}

// A channel without declared errors rejects with the general shape.
declare const plain: IpcError;
export const plainCode: string | number | undefined = plain.code;
export const plainMessage: string = plain.message;

export const user: Promise<string> = window.ipc.getUser.invoke(1);
