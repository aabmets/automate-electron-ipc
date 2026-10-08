import { defineChannels, mainPort, port } from "automate-electron-ipc";

export default defineChannels({
   logTail: mainPort<(line: string, level?: number) => void>({ maxQueue: 3 }),
   meters: mainPort<(value: number) => void>({ maxQueue: 0 }),
   // biome-ignore lint/style/useNumberNamespace: the schema syntax for no limit is Infinity
   frames: mainPort<(frame: number) => void>({ maxQueue: Infinity }),
   defaulted: mainPort<(line: string) => void>(),
   chat: port<(msg: string) => void>({ maxQueue: 2 }),
   nobody: port<(msg: string) => void>({ maxQueue: 0 }),
   plain: port<(msg: string) => void>(),
});
