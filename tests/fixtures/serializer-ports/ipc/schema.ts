import { defineChannels, mainPort, port } from "automate-electron-ipc";

export default defineChannels({
   // Two pages: the main process pairs them, and sees none of the messages.
   tracker: port<(at: Date, tags: Set<string>) => void>(),
   // The main process and a page.
   feed: mainPort<(at: Date, counts: Map<string, number>) => void>(),
});
