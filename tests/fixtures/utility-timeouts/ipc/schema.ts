import {
   callMain,
   callUtility,
   defineChannels,
   invokeUtility,
   notifyUtility,
   streamUtility,
} from "automate-electron-ipc";

export default defineChannels({
   // The main process to the utility process: its own timeout, the default of the config, none.
   slowIndex: callUtility<(path: string) => Promise<number>>({ timeoutMs: 1000 }),
   defaultedIndex: callUtility<(path: string) => Promise<number>>(),
   patientIndex: callUtility<() => Promise<string>>({ timeoutMs: 0 }),
   legacyIndex: callUtility({ timeoutMs: 300 }) as () => Promise<void>,
   // The utility process to the main process.
   slowSetting: callMain<(key: string) => Promise<string>>({ timeoutMs: 800 }),
   defaultedSetting: callMain<(key: string) => Promise<string>>(),
   patientSetting: callMain<() => Promise<string>>({ timeoutMs: 0 }),
   // A notification has no reply to wait for.
   pause: notifyUtility<() => void>(),
   // A page to the utility process.
   slowQuery: invokeUtility<(sql: string) => Promise<string>>({ timeoutMs: 1200 }),
   defaultedQuery: invokeUtility<(sql: string) => Promise<string>>(),
   patientQuery: invokeUtility<() => Promise<string>>({ timeoutMs: 0 }),
   slowRows: streamUtility<(table: string) => AsyncIterable<number>>({ timeoutMs: 700 }),
   plainRows: streamUtility<() => AsyncIterable<number>>(),
});
