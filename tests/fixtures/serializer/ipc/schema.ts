import { ask, defineChannels, emit, invoke, send, stream } from "automate-electron-ipc";
import { whenArgs } from "./validators";

export interface Appointment {
   at: Date;
   tags: Set<string>;
   attendees: Map<string, number>;
   budget: bigint;
}

export default defineChannels({
   getAppointment: invoke<(id: number, since: Date) => Promise<Appointment>>(),
   logVisit: send<(at: Date, tags: Map<string, number>) => void>(),
   changed: emit<(appointment: Appointment) => void>(),
   askClock: ask<(zone: string) => Promise<Date>>(),
   history: stream<(since: Date) => AsyncIterable<Appointment>>(),
   // The arguments are validated after they are deserialized.
   checked: invoke<(when: Date) => Promise<Date>>({ validate: whenArgs }),
   // Without arguments and without a result.
   ping: invoke<() => Promise<void>>(),
});
