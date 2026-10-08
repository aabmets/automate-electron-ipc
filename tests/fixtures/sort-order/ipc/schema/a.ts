import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   alpha: send<() => void>(),
   aLpha: send<() => void>(),
   alzz: invoke<() => Promise<string>>(),
   item: invoke<() => Promise<number>>(),
   bRavo: emit<() => void>(),
});
