import {
   callMain,
   callUtility,
   defineChannels,
   invokeUtility,
   notifyMain,
   notifyUtility,
   streamUtility,
} from "automate-electron-ipc";

export default defineChannels({
   // The main process to the utility process.
   shift: callUtility<(at: Date, by: number) => Promise<Date>>(),
   tell: notifyUtility<(at: Date, tags: Set<string>) => void>(),
   // The utility process to the main process.
   clock: callMain<() => Promise<Date>>(),
   tick: notifyMain<(at: Date, counts: Map<string, number>) => void>(),
   // A page to the utility process, over a port that the main process brokers.
   lookup: invokeUtility<(at: Date) => Promise<Map<string, Date>>>(),
   dates: streamUtility<(since: Date) => AsyncIterable<Date>>(),
});
