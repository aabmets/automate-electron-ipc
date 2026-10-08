import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   item2: invoke<() => Promise<number>>(),
   item_x: send<() => void>(),
   itemX: send<() => void>(),
   zöld: send<(value: number) => void>(),
   bravo: emit<(value: string) => void>(),
});
