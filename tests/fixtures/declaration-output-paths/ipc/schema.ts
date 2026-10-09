import { callUtility, defineChannels, sendFromWorker } from "automate-electron-ipc";

// The output paths of the config are declaration files, which cannot hold runtime code.
export default defineChannels({
   compute: callUtility<(a: number) => Promise<number>>(),
   report: sendFromWorker<(a: number) => void>(),
});
