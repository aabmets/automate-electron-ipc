import { callMain, defineChannels, invokeFromWorker } from "automate-electron-ipc";

// None of these channels is between a page and the main process, and none is a port channel,
// so none uses the serializer yet (the traffic with a utility process or a worker is not covered).
export default defineChannels({
   lookup: invokeFromWorker<(key: string) => Promise<number>>(),
   report: callMain<(at: number) => Promise<void>>(),
});
