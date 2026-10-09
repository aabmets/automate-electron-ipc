import { defineChannels, stream } from "automate-electron-ipc";

export class StreamFailure extends Error {
   override readonly name = "StreamFailure";
   readonly code = "E_STREAM";
   readonly data: { at: number };
   constructor(data: { at: number }) {
      super("the stream failed");
      this.data = data;
   }
}

export default defineChannels({
   count: stream<(to: number) => AsyncIterable<number>>(),
   endless: stream<() => AsyncIterable<number>>(),
   broken: stream<(failAt: number) => AsyncIterable<number>, StreamFailure>(),
   windowed: stream<() => AsyncIterable<number>>({ highWaterMark: 4 }),
   pulled: stream<() => AsyncIterable<number>>({ highWaterMark: 0 }),
});
