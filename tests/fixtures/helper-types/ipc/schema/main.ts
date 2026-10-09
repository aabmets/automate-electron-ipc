import { ask, defineChannels, emit, invoke, port, send, stream } from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export class NotFoundError extends Error {
   readonly code = "E_NOT_FOUND" as const;
}

// The verb call form: the signature is the type argument.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>, NotFoundError>(),
   logLine: send<(text: string, level?: number) => void>(),
   titleChanged: emit<(title: string) => void>(),
   rows: stream<(table: string) => AsyncIterable<User>>(),
   hasUnsaved: ask<(documentId: number) => boolean>(),
   chat: port<(message: string) => void>(),
});
