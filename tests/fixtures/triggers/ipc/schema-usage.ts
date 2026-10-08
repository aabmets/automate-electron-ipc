// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the generated types are wrong.
import type { BrowserWindow } from "electron";
import { ipcMain } from "./main";

declare const win: BrowserWindow;

export const dispose: () => void = ipcMain.bindWindowFocused(win, () => [true]);
export const disposeAsync: () => void = ipcMain.bindWindowFocused(win, async () => [false]);
export const disposeRest: () => void = ipcMain.bindTitleChanged(win, () => ["title", "a", "b"]);
export const disposeWithOnError: () => void = ipcMain.bindWindowFocused(
   win,
   () => [true],
   (error: unknown) => console.error(error),
);

// @ts-expect-error the provider must return the tuple of arguments
ipcMain.bindWindowFocused(win, () => true);
// @ts-expect-error the arguments must match the signature
ipcMain.bindWindowFocused(win, () => ["not a boolean"]);
// @ts-expect-error channels without a trigger have no binder
ipcMain.bindPlain(win, () => [1]);

// The sender stays available for every channel and sends immediately.
ipcMain.sendWindowFocused(win, true);
ipcMain.sendTitleChanged(win, "title", "a", "b");
ipcMain.sendPlain(win, 1);
