import { defineChannels, sendFromWorker } from "automate-electron-ipc";

export default defineChannels({
   a: sendFromWorker<(k: string) => void>(),
});
