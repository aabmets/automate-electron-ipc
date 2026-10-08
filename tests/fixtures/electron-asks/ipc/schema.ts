import { ask, defineChannels } from "automate-electron-ipc";

export default defineChannels({
   double: ask<(n: number) => Promise<number>>(),
   silent: ask<() => Promise<string>>(),
   delayed: ask<(label: string, ms: number) => Promise<string>>(),
   failing: ask<() => Promise<string>>(),
});
