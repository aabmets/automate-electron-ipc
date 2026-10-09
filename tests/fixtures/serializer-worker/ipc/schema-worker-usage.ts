// The code of the service worker: the preload script exposes the API as a global, and the worker
// has the same types as the main process.
export async function inWorker(): Promise<void> {
   const shifted: Date = await ipc.shift.invoke(new Date(), 1);
   const checked: Date = await ipc.checked.invoke(new Date());
   ipc.tell.send(new Date(), new Set(["a"]));
   ipc.checkedTell.send(new Date());
   console.log(shifted, checked);

   ipc.zone.handle(async (at: Date) => new Map([["at", at]]));
   ipc.tick.on((at: Date, counts: Map<string, number>) => console.log(at, counts));

   // @ts-expect-error the worker sends a Date, not a number
   ipc.shift.invoke(1, 1);
   // @ts-expect-error the question carries a Date
   ipc.zone.handle(async (at: string) => new Map([["at", new Date(at)]]));
}
