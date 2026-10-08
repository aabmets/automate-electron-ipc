// Not a schema: it uses the generated bindings the way an application would.
import { ipcMain } from "./main";

export const echoed: Promise<number> = window.ipc.sendGenericInvoke(1);

ipcMain.onGenericSend((_event, cb) => cb(1));
ipcMain.onGenericInvoke((_event, value) => value);
