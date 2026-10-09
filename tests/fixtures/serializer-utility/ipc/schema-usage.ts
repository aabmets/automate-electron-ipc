// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// Not a schema: it uses the generated bindings the way an application would, so that the
// type-check fails when the serializer changes the types that the three sides see.
import type { BrowserWindow, UtilityProcess } from "electron";
import { ipc as mainIpc } from "./main";
import { ipc as utilityIpc } from "./utility";

declare const child: UtilityProcess;
declare const win: BrowserWindow;

// Main: the values have the types of the signatures, not the wire value.
export const shifted: Promise<Date> = mainIpc.shift.invoke(child, new Date(), 1);
mainIpc.tell.send(child, new Date(), new Set(["a"]));
mainIpc.clock.handle(child, async () => new Date());
mainIpc.tick.on(child, (at: Date, counts: Map<string, number>) => console.log(at, counts));
mainIpc.lookup.connect(child, win);
// @ts-expect-error the main process sends a Date, not a number
mainIpc.shift.invoke(child, 1, 1);

// Utility: the same signatures.
utilityIpc.shift.handle(async (at: Date, by: number) => new Date(at.getTime() + by));
utilityIpc.tell.on((at: Date, tags: Set<string>) => console.log(at, tags));
export const now: Promise<Date> = utilityIpc.clock.invoke();
utilityIpc.tick.send(new Date(), new Map([["a", 1]]));
utilityIpc.lookup.handle(async (at: Date) => new Map([["at", at]]));
utilityIpc.dates.handle(async function* (since: Date) {
   yield since;
});
// @ts-expect-error the chunks are Dates
utilityIpc.dates.handle(async function* () {
   yield "text";
});

// Renderer: the page gets the same types.
export const found: Promise<Map<string, Date>> = ipc.lookup.invoke(new Date());
export const dates: AsyncIterable<Date> = ipc.dates.stream(new Date());
// @ts-expect-error the page sends a Date, not a number
ipc.lookup.invoke(1);
