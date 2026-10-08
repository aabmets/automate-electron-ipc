import { defineChannels, mainPort, port } from "automate-electron-ipc";

export default defineChannels({
   logTail: mainPort<(line: string, level?: number) => void>(),
   chat: port<(msg: string) => void>(),
});
