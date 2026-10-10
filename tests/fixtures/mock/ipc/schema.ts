import {
   ask,
   defineChannels,
   emit,
   invoke,
   invokeUtility,
   port,
   send,
   stream,
   streamUtility,
} from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   getTime: invoke<() => number>(),
   logLine: send<(text: string, level?: number) => void>(),
   rows: stream<(table: string) => AsyncIterable<User>>(),
   titleChanged: emit<(title: string) => void>(),
   progress: emit<(percent: number, label?: string) => void>(),
   hasUnsaved: ask<(documentId: number) => boolean>(),
   askName: ask<() => Promise<string>>(),
   chat: port<(message: string) => void>(),
   // A page to a utility process, which the page calls like a channel of the main process.
   indexFile: invokeUtility<(path: string) => Promise<number>>(),
   lines: streamUtility<(path: string) => AsyncIterable<string>>(),
});
