import { defineChannels, emit, invoke, send } from "automate-electron-ipc";
import noArgs, { idArgs, lineArgs as lineSchema } from "./validators";

export default defineChannels({
   getSecret: invoke<(id: number) => Promise<string>>({
      allowedOrigins: ["app://."],
      validate: idArgs,
   }),
   getCount: invoke<(id: number) => number>({ validate: idArgs }),
   getPublic: invoke<() => Promise<number>>(),
   logLine: send<(text: string, ...rest: number[]) => void>({ validate: lineSchema }),
   ping: send<() => void>({ validate: noArgs }),
   progress: emit<(percent: number) => void>(),
});
