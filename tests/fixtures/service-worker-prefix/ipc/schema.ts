import { askWorker, defineChannels, invokeFromWorker } from "automate-electron-ipc";

export default defineChannels({
   getToken: invokeFromWorker<() => string>(),
   flushQueue: askWorker<() => number>(),
});
