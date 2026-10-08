import { defineChannels, emit, port } from "automate-electron-ipc";

export const channels = defineChannels({
   windowBlurred: emit<(blurred: boolean) => void>({ trigger: "blur" }),
   logStream: port<(line: string) => void>(),
});
