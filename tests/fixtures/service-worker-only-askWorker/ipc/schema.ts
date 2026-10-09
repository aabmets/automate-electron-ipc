import { askWorker, defineChannels } from "automate-electron-ipc";

export default defineChannels({
   a: askWorker<(k: string) => number>(),
});
