import { ask, defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   // A sync signature whose result is a Promise or the value itself.
   lookup: invoke<(id: number) => Promise<string> | string>(),
   maybe: invoke<() => Promise<string | null> | null>(),
   // `Awaited` and `PromiseLike` in a result.
   awaited: invoke<() => Awaited<Promise<number>>>(),
   thenable: invoke<() => PromiseLike<boolean>>(),
   // A handler of a fire-and-forget channel may be async.
   log: send<(text: string) => Promise<void> | void>(),
   describe: ask<(id: number) => Promise<string> | string>(),
});
