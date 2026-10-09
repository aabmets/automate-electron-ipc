import { defineChannels, invokeFromWorker } from "automate-electron-ipc";

export default defineChannels({
   a: invokeFromWorker<(k: string) => number>(),
});
