import {
   callUtility,
   defineChannels,
   invoke,
   invokeUtility,
   streamUtility,
} from "automate-electron-ipc";

export interface Row {
   id: number;
   label: string;
}

export class QueryError extends Error {
   readonly code = "E_QUERY" as const;
   readonly data!: { sql: string };
}

export default defineChannels({
   // A page to the utility process, over a port that the main process brokers.
   queryRows: invokeUtility<(sql: string, limit?: number) => Promise<Row[]>, QueryError>(),
   countRows: invokeUtility<(table: string) => number>(),
   ping: invokeUtility<() => void>(),
   tagged: invokeUtility<(label: string, ...tags: string[]) => Promise<string>>(),
   asForm: invokeUtility() as (n: number) => Promise<number>,
   scanRows: streamUtility<(table: string) => AsyncIterable<Row>, QueryError>(),
   counter: streamUtility<() => AsyncGenerator<number, void, undefined>>(),
   streamForm: streamUtility() as (seed: string) => AsyncIterable<string>,
   // The main process to the utility process, next to the ports of the pages.
   indexFile: callUtility<(path: string) => Promise<number>>(),
   // A channel to the main process, which the utility file must leave alone.
   getUser: invoke<(id: number) => Promise<string>>(),
});
