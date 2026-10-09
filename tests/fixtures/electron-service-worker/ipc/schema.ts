import {
   askWorker,
   defineChannels,
   emitToWorker,
   invokeFromWorker,
   sendFromWorker,
} from "automate-electron-ipc";
import { idArgs } from "./validators";

export interface Token {
   value: string;
   scope: string;
}

export default defineChannels({
   // A service worker to the main process.
   getToken: invokeFromWorker<(scope: string) => Promise<Token>>(),
   add: invokeFromWorker<(a: number, b: number) => number>(),
   restricted: invokeFromWorker<() => string>({ allowedOrigins: ["app://other"] }),
   allowed: invokeFromWorker<() => string>({ allowedOrigins: ["app://main"] }),
   // The arguments are validated in the main process.
   checked: invokeFromWorker<(id: number) => string>({ validate: idArgs }),
   checkedSend: sendFromWorker<(id: number) => void>({ validate: idArgs }),
   // The handler of this one is made to hang, so the call times out.
   hang: invokeFromWorker<() => string>({ timeoutMs: 300 }),
   syncDone: sendFromWorker<(pending: number, note: string) => void>(),
   restrictedSend: sendFromWorker<() => void>({ allowedOrigins: ["app://other"] }),
   // The main process to a service worker.
   flushQueue: askWorker<(force: boolean) => number>(),
   neverAnswers: askWorker<() => number>(),
   configChanged: emitToWorker<(key: string, value: unknown) => void>(),
});
