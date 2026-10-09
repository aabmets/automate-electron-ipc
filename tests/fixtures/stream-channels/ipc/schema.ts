import { defineChannels, emit, invoke, stream } from "automate-electron-ipc";
import { countArgs } from "./validators";

export interface Row {
   id: number;
   label: string;
}

export interface Progress {
   done: number;
   total: number;
}

export class NotFoundError extends Error {
   readonly code = "E_NOT_FOUND" as const;
   readonly data!: { table: string };
}

export default defineChannels({
   exportRows: stream<(table: string, limit?: number) => AsyncIterable<Row>, NotFoundError>(),
   tokens: stream<(prompt: string) => AsyncGenerator<string, void, undefined>>(),
   counter: stream<() => AsyncIterableIterator<number>>(),
   progress: stream<(job: string, ...flags: boolean[]) => AsyncIterable<Progress>>(),
   // Parameter names which the generated wrappers use themselves.
   nameClash:
      stream<
         (event: string, id: number, rest: boolean, handler: string) => AsyncIterable<string>
      >(),
   genericStream: stream<<T>(seed: T) => AsyncIterable<T>>(),
   // The options of the call.
   guarded: stream<(count: number) => AsyncIterable<number>>({
      allowedOrigins: ["app://."],
      validate: countArgs,
   }),
   // The flow control of the stream: a window of unread chunks, a pull-based stream, and no limit.
   windowed: stream<() => AsyncIterable<number>>({ highWaterMark: 4 }),
   pulled: stream<() => AsyncIterable<number>>({ highWaterMark: 0 }),
   // biome-ignore lint/style/useNumberNamespace: the schema syntax for no limit is Infinity
   unbounded: stream<() => AsyncIterable<number>>({ highWaterMark: Infinity }),
   // The as form.
   asForm: stream() as (count: number) => AsyncIterable<number>,
   // The other verbs next to the streams.
   getUser: invoke<(id: number) => Promise<string>>(),
   notice: emit<(text: string) => void>(),
});
