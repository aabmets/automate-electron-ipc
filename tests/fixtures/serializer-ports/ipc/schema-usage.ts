// Not a schema: it uses the generated bindings the way an application would, so that the
// type-check fails when the serializer changes the types that the page and the main process see.
import type { BrowserWindow } from "electron";
import { ipc as mainIpc } from "./main";

declare const win: BrowserWindow;

// Main: the messages of the connection are typed with the signature, not with the wire value.
export const connection = mainIpc.feed.connect(win);
connection.send(new Date(), new Map([["ada", 1]]));
connection.on((at: Date, counts: Map<string, number>) => console.log(at.getTime(), counts.size));
mainIpc.tracker.connect(win, win);

// @ts-expect-error the main process sends a Date, not a number
connection.send(1, new Map());

// Renderer: the same signature on both channels.
ipc.tracker.send(new Date(), new Set(["a"]));
ipc.tracker.on((at: Date, tags: Set<string>) => console.log(at.getTime(), tags.size));
ipc.feed.send(new Date(), new Map());
ipc.feed.onConnection((peer) => {
   peer.on((at: Date, counts: Map<string, number>) => console.log(at.getTime(), counts.size));
});

// @ts-expect-error the page sends a Date, not a number
ipc.tracker.send(1, new Set());
