import {
   askWorker,
   defineChannels,
   emitToWorker,
   invoke,
   invokeFromWorker,
   sendFromWorker,
} from "automate-electron-ipc";

export interface Token {
   value: string;
   expires: number;
}

export interface SyncState {
   pending: number;
}

export class NotSignedInError extends Error {
   code = "NOT_SIGNED_IN" as const;
}

export default defineChannels({
   // A service worker to the main process.
   getToken: invokeFromWorker<
      (scope: string, force?: boolean) => Promise<Token>,
      NotSignedInError
   >(),
   saveBlob: invokeFromWorker<(name: string, ...chunks: string[]) => number>({
      allowedOrigins: ["app://main", "http://localhost:5173"],
   }),
   echo: invokeFromWorker<<T>(value: T) => T>(),
   syncDone: sendFromWorker<(state: SyncState) => void>(),
   log: sendFromWorker<(level: "info" | "warn", message: string) => Promise<void>>({
      allowedOrigins: ["app://main"],
   }),
   // The main process to a service worker.
   flushQueue: askWorker<(force: boolean) => number>(),
   describe: askWorker<() => Promise<SyncState>>(),
   configChanged: emitToWorker<(key: string, value: unknown) => void>(),
   goOffline: emitToWorker<() => void>(),
   // A channel for a page, which the worker files must leave alone.
   getUser: invoke<(id: number) => Promise<Token>>(),
});
