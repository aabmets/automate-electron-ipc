import { callUtility, defineChannels, invokeUtility, streamUtility } from "automate-electron-ipc";

export interface Row {
   id: number;
   label: string;
}

export default defineChannels({
   // The page calls the utility process.
   query: invokeUtility<(sql: string, limit?: number) => Promise<Row[]>>(),
   whoami: invokeUtility<() => Promise<number>>(),
   fail: invokeUtility<() => Promise<string>>(),
   hang: invokeUtility<() => Promise<string>>(),
   hangTimed: invokeUtility<() => Promise<string>>({ timeoutMs: 300 }),
   unregistered: invokeUtility<() => Promise<string>>(),
   unsendable: invokeUtility<() => unknown>(),
   // The page reads streams of the utility process.
   count: streamUtility<(to: number) => AsyncIterable<number>>(),
   endless: streamUtility<() => AsyncIterable<number>>(),
   hangStream: streamUtility<() => AsyncIterable<number>>({ timeoutMs: 300 }),
   broken: streamUtility<(failAt: number) => AsyncIterable<number>>(),
   windowed: streamUtility<() => AsyncIterable<number>>({ highWaterMark: 4 }),
   // The main process asks the utility process, next to the ports of the pages.
   double: callUtility<(n: number) => Promise<number>>(),
   finalized: callUtility<() => Promise<boolean>>(),
   produced: callUtility<() => Promise<number>>(),
});
