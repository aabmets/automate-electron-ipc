import { ask, defineChannels, emit, invoke, port, send, stream } from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export class NotFoundError extends Error {
   readonly code = "E_NOT_FOUND" as const;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>, NotFoundError>(),
   sum: invoke<(a: number, b: number) => number>(),
   ping: invoke<() => Promise<void>>(),
   logLine: send<(text: string, level?: number) => void>(),
   titleChanged: emit<(title: string) => void>(),
   moved: emit<(x: number, y: number) => void>(),
   rows: stream<(table: string) => AsyncIterable<User>>(),
   hasUnsaved: ask<(documentId: number) => boolean>(),
   chat: port<(message: string) => void>(),
});
