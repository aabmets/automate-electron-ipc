import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   // Parameter names which the generated wrappers use themselves.
   windowClash: emit<(browserWindow: number, event: string, callback: boolean) => void>(),
   handlerClash: send<(event: string, callback: number, args: boolean) => void>(),
   invokeClash: invoke<(event: string, callback: number) => Promise<string>>(),
   noParams: send<() => void>(),
   // Signatures whose text has a `(` before the parameter list.
   genericEmit: emit<<T extends (x: number) => void>(cb: T) => void>(),
   genericSend: send<<T extends (x: number) => void>(cb: T) => void>(),
   genericInvoke: invoke<<T>(value: T) => T>(),
});
