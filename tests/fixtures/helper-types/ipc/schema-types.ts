// Not a schema: it checks the helper types the way an application uses them, so that the
// type-check fails when a helper gives the wrong type.
import type { User } from "./schema/main";
import type { ChannelArgs, ChannelName, ChannelReturn } from "./types";

type Equal<A, B> =
   (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The name of every channel of the page, from both declaration forms and both schema files.
export const names: Equal<
   ChannelName,
   | "chat"
   | "countThings"
   | "getUser"
   | "hasUnsaved"
   | "logLine"
   | "notify"
   | "rows"
   | "ticks"
   | "titleChanged"
> = true;

// The arguments are the parameters of the signature, with the names, the optionals and the rests.
export const invokeArgs: Equal<ChannelArgs<"getUser">, [id: number]> = true;
export const sendArgs: Equal<ChannelArgs<"logLine">, [text: string, level?: number]> = true;
export const emitArgs: Equal<ChannelArgs<"titleChanged">, [title: string]> = true;
export const streamArgs: Equal<ChannelArgs<"rows">, [table: string]> = true;
export const askArgs: Equal<ChannelArgs<"hasUnsaved">, [documentId: number]> = true;
export const portArgs: Equal<ChannelArgs<"chat">, [message: string]> = true;
export const asFormArgs: Equal<
   ChannelArgs<"countThings">,
   [kind: "a" | "b", limit?: number]
> = true;

// The result of the handler with its promise resolved, and the chunk of a stream.
export const invokeReturn: Equal<ChannelReturn<"getUser">, User> = true;
export const sendReturn: Equal<ChannelReturn<"logLine">, void> = true;
export const emitReturn: Equal<ChannelReturn<"titleChanged">, void> = true;
export const streamReturn: Equal<ChannelReturn<"rows">, User> = true;
export const askReturn: Equal<ChannelReturn<"hasUnsaved">, boolean> = true;
export const portReturn: Equal<ChannelReturn<"chat">, void> = true;
export const asFormReturn: Equal<ChannelReturn<"countThings">, number[]> = true;
export const asFormStreamReturn: Equal<ChannelReturn<"ticks">, number> = true;

// @ts-expect-error a name which is not a channel of the page is not a ChannelName
export type Unknown = ChannelArgs<"nope">;

// The page itself has the global that window.d.ts declares.
export const user: Promise<User> = window.ipc.getUser.invoke(1);
