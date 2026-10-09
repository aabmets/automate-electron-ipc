import { callMain, defineChannels, port } from "automate-electron-ipc";

// None of these channels is between a page and the main process, so none uses the serializer.
export default defineChannels({
   link: port<(at: Date) => void>(),
   report: callMain<(at: number) => Promise<void>>(),
});
