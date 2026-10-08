import { defineChannels, invoke, send } from "automate-electron-ipc";

// Not exported and not used by any channel.
interface Internal {
   secret: string;
}

type Unused = Internal | null;

export default interface Payload {
   id: number;
   tags: string[];
}

export interface Box<T> {
   value: T;
   extra?: Unused;
}

export const channels = defineChannels({
   // Type parameters of the signature are not custom types.
   echo: invoke<<T>(value: T) => Promise<T>>(),
   // Well-known globals need no import.
   storeAll:
      invoke<
         (
            items: Map<string, Payload>,
            at: Date,
            bytes: Uint8Array,
         ) => Promise<Record<string, Box<Date>>>
      >(),
   report: send<(payload: Payload, errors: Error[]) => void>(),
});
