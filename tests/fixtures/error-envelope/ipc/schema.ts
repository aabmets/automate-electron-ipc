import { defineChannels, invoke, send } from "automate-electron-ipc";

export class NotFoundError extends Error {
   override readonly name = "NotFoundError";
   readonly code = "NOT_FOUND";
   readonly data: { id: number };
   constructor(data: { id: number }) {
      super("not found");
      this.data = data;
   }
}

export class AuthError extends Error {
   override readonly name = "AuthError";
   readonly code = 401;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>, NotFoundError | AuthError>(),
   getPlain: invoke<() => number>(),
   deleteUser: invoke<(id: number) => void, NotFoundError>(),
   parse: invoke<(text: string) => number, TypeError | RangeError>(),
   ping: send<() => void>(),
});
