// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the generated types are wrong.
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { ipcMain } from "./main";

ipcMain.onGetUser(async (event: IpcMainInvokeEvent, id: number) => `${event.sender.id}:${id}`);
ipcMain.onEcho((event: IpcMainEvent, text: string, ...rest: number[]) => {
   event.reply("echoed", text, rest);
});

type IsPromise<T> = T extends Promise<unknown> ? true : false;

// Broadcast senders return nothing, since `ipcRenderer.send` returns `undefined`.
export const echoIsPromise: IsPromise<ReturnType<typeof window.ipc.sendEcho>> = false;
export const pingIsPromise: IsPromise<ReturnType<typeof window.ipc.sendPing>> = false;
export const userResult: Promise<string> = window.ipc.sendGetUser(1);
