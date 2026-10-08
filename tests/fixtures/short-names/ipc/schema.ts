import { defineChannels, emit, invoke, port, send } from "automate-electron-ipc";

// Names that the old listener-name rules rejected: short, 'on'-prefixed and capitalized.
export default defineChannels({
   ok: invoke<(id: number) => Promise<string>>(),
   on: send<(flag: boolean) => void>(),
   onReady: emit<(ready: boolean) => void>(),
   Capital: invoke<() => Promise<number>>(),
   _hidden: send<() => void>(),
   p: port<(msg: string) => void>(),
   $dollar: send<(text: string) => void>(),
});
