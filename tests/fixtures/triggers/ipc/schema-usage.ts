// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the generated types are wrong.
import type { BrowserWindow } from "electron";
import { ipc } from "./main";

declare const win: BrowserWindow;

export const dispose: () => void = ipc.windowFocused.bind(win, () => [true]);
export const disposeAsync: () => void = ipc.windowFocused.bind(win, async () => [false]);
export const disposeRest: () => void = ipc.titleChanged.bind(win, () => ["title", "a", "b"]);
export const disposeWithOnError: () => void = ipc.windowFocused.bind(
   win,
   () => [true],
   (error: unknown) => console.error(error),
);

// @ts-expect-error the provider must return the tuple of arguments
ipc.windowFocused.bind(win, () => true);
// @ts-expect-error the arguments must match the signature
ipc.windowFocused.bind(win, () => ["not a boolean"]);
// @ts-expect-error channels without a trigger have no binder
ipc.plain.bind(win, () => [1]);

// The sender stays available for every channel and sends immediately.
ipc.windowFocused.send(win, true);
ipc.titleChanged.send(win, "title", "a", "b");
ipc.plain.send(win, 1);
