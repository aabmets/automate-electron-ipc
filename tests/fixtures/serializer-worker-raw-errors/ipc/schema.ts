import { defineChannels, invokeFromWorker } from "automate-electron-ipc";

export default defineChannels({
   shift: invokeFromWorker<(at: Date, by: number) => Promise<Date>>(),
});
