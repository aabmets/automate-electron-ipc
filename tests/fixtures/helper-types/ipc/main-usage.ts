// Not a schema: a file of the main process that takes the types from types.ts alone. The test
// compiles it without window.d.ts, so it must not get the global variable of the page.
import type { ChannelArgs, ChannelName, IpcApi, IpcError } from "./types";

export function describeCall<N extends ChannelName>(name: N, ...args: ChannelArgs<N>): string {
   return `${name}(${args.join(", ")})`;
}

export const call: string = describeCall("getUser", 1);
export type Api = IpcApi;
export type Failure = IpcError<Error>;

// @ts-expect-error the types module does not declare the variable of the page
export const missing = window.ipc;
