// Not a schema: it uses the generated bindings of the main process the way an application would, so
// that the type-check fails when the serializer changes the types that the main process sees.
import type { ServiceWorkerMain, Session } from "electron";
import { ipc } from "./main";

declare const session: Session;
declare const worker: ServiceWorkerMain;

// The values have the types of the signatures, not the wire value.
ipc.shift.handle(session, (_event, at: Date, by: number) =>
   Promise.resolve(new Date(at.getTime() + by)),
);
ipc.checked.handle(session, (_event, at: Date) => at);
ipc.tell.on(session, (_event, at: Date, tags: Set<string>) => console.log(at, tags));
ipc.checkedTell.once(session, (_event, at: Date) => console.log(at));
export const zone: Promise<Map<string, Date>> = ipc.zone.invoke(worker, new Date());
export const timed: Promise<Map<string, Date>> = ipc.zone.invokeWith(
   worker,
   { timeoutMs: 1 },
   new Date(),
);
ipc.tick.send(worker, new Date(), new Map([["a", 1]]));
ipc.tick.broadcast(session, new Date(), new Map([["a", 1]]));
// @ts-expect-error the main process asks with a Date, not a number
ipc.zone.invoke(worker, 1);
// @ts-expect-error the handler takes a Date
ipc.shift.handle(session, (_event, at: string) => Promise.resolve(new Date(at)));
