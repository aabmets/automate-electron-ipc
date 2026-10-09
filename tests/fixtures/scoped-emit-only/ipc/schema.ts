import { defineChannels, emit, invoke } from "automate-electron-ipc";

export default defineChannels({
   getVersion: invoke<() => Promise<string>>(),
   // Sent by the main process: the preload script of the scope has it, and no call is guarded.
   progress: emit<(percent: number) => void>({ scopes: ["hud"] }),
});
