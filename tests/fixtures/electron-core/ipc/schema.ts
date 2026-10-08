import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export class AppError extends Error {
   override readonly name = "AppError";
   readonly code = "E_APP";
   readonly data: { id: number; tags: string[] };
   constructor(data: { id: number; tags: string[] }) {
      super("the app failed");
      this.data = data;
   }
}

export default defineChannels({
   // invoke
   getValue: invoke<(id: number) => Promise<string>>(),
   fail: invoke<(id: number) => Promise<string>, AppError>(),
   missing: invoke<() => Promise<string>>(),
   once: invoke<() => Promise<number>>(),
   replaced: invoke<() => Promise<string>>(),
   // send
   log: send<(text: string, ...rest: number[]) => void>(),
   optional: send<(text: string, count?: number) => void>(),
   // emit
   notice: emit<(text: string, count?: number) => void>(),
   tick: emit<(n: number) => void>(),
   titleChanged: emit<(title: string) => void>({ trigger: "page-title-updated" }),
});
