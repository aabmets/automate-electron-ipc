import { defineChannels, invoke, send, stream } from "automate-electron-ipc";

// The `as` form: the signature is the type of the value, and the map is a named export.
export const channels = defineChannels({
   countThings: invoke() as (kind: "a" | "b", limit?: number) => Promise<number[]>,
   ticks: stream() as () => AsyncGenerator<number, void, undefined>,
   notify: send() as (text: string) => void,
});
