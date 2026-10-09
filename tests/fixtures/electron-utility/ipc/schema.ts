import {
   callMain,
   callUtility,
   defineChannels,
   notifyMain,
   notifyUtility,
} from "automate-electron-ipc";

export interface Row {
   id: number;
   label: string;
}

export default defineChannels({
   // The main process calls the utility process.
   double: callUtility<(n: number) => Promise<number>>(),
   rows: callUtility<(count: number) => Row[]>(),
   fail: callUtility<() => Promise<string>>(),
   hang: callUtility<() => Promise<string>>(),
   hangTimed: callUtility<() => Promise<string>>({ timeoutMs: 300 }),
   delayed: callUtility<(ms: number) => Promise<string>>({ timeoutMs: 300 }),
   unregistered: callUtility<() => Promise<string>>(),
   unsendable: callUtility<() => unknown>(),
   viaMain: callUtility<(key: string) => Promise<string>>(),
   // The main process notifies the utility process.
   start: notifyUtility<(total: number) => void>(),
   crash: notifyUtility<(code: number) => void>(),
   // The utility process calls the main process.
   getSetting: callMain<(key: string) => Promise<string>>(),
   hangSetting: callMain<(key: string) => Promise<string>>({ timeoutMs: 300 }),
   // The utility process notifies the main process.
   progress: notifyMain<(done: number, total: number) => void>(),
});
