// Not a schema: it uses the generated bindings the way an application would, so that the
// type-check fails when the serializer changes the types that the page and the main process see.
import { ipc as mainIpc } from "./main";
import type { Appointment } from "./schema";

mainIpc.getAppointment.handle(async (_event, id: number, since: Date) => ({
   at: since,
   tags: new Set([String(id)]),
   attendees: new Map([["ada", 1]]),
   budget: 10n,
}));
mainIpc.logVisit.on((_event, at: Date, tags: Map<string, number>) => {
   console.log(at.getTime(), tags.size);
});
mainIpc.checked.handle(async (_event, when: Date) => when);

export async function sendNotices(window: Electron.BrowserWindow): Promise<Date> {
   mainIpc.changed.send(window, {
      at: new Date(),
      tags: new Set(),
      attendees: new Map(),
      budget: 0n,
   });
   mainIpc.changed.broadcast({ at: new Date(), tags: new Set(), attendees: new Map(), budget: 1n });
   return await mainIpc.askClock.invoke(window, "UTC");
}

export async function readInPage(): Promise<Appointment> {
   ipc.askClock.handle(async (zone: string) => new Date(zone));
   ipc.changed.on((appointment: Appointment) => console.log(appointment.at.getTime()));
   ipc.logVisit.send(new Date(), new Map());
   for await (const appointment of ipc.history.stream(new Date())) {
      console.log(appointment.budget);
   }
   const when: Date = await ipc.checked.invoke(new Date());
   console.log(when.getTime());
   return await ipc.getAppointment.invoke(1, new Date());
}

// @ts-expect-error the page sends a Date, not a number
ipc.getAppointment.invoke(1, 5);
