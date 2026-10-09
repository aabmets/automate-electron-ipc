import {
   askWorker,
   defineChannels,
   emitToWorker,
   invokeFromWorker,
   sendFromWorker,
} from "automate-electron-ipc";
import { dateArgs } from "./validators";

export default defineChannels({
   // A service worker to the main process.
   shift: invokeFromWorker<(at: Date, by: number) => Promise<Date>>(),
   checked: invokeFromWorker<(at: Date) => Date>({ validate: dateArgs }),
   tell: sendFromWorker<(at: Date, tags: Set<string>) => void>(),
   checkedTell: sendFromWorker<(at: Date) => void>({ validate: dateArgs }),
   // The main process to a service worker.
   zone: askWorker<(at: Date) => Promise<Map<string, Date>>>(),
   tick: emitToWorker<(at: Date, counts: Map<string, number>) => void>(),
});
