import { defineChannels, mainPort, port } from "automate-electron-ipc";

export default defineChannels({
   chat: port<(msg: string) => void>(),
   logTail: mainPort<(line: string, level?: number) => void>(),
   bounded: mainPort<(n: number) => void>({ maxQueue: 3 }),
});
