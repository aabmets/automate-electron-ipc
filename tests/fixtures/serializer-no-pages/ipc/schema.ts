import { askWorker, defineChannels, invokeFromWorker } from "automate-electron-ipc";

// None of these channels is between a page and the main process, a port channel or a channel of a
// utility process, so none uses the serializer yet (the traffic with a service worker is not covered).
export default defineChannels({
   lookup: invokeFromWorker<(key: string) => Promise<number>>(),
   zone: askWorker<(name: string) => Promise<number>>(),
});
