import { defineChannels, emitToWorker } from "automate-electron-ipc";

export default defineChannels({
   a: emitToWorker<(k: string) => void>(),
});
