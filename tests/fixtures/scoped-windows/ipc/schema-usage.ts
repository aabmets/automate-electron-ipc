// Not a schema: it uses the generated bindings of the main process the way an application would.
import type { BrowserWindow } from "electron";
import { type IpcScope, ipc, registerScope } from "./main";

const scope: IpcScope = "settings";
export const dispose: () => void = registerScope({} as BrowserWindow, scope);
// @ts-expect-error the schema declares no scope 'admin'
registerScope({} as BrowserWindow, "admin");

ipc.getSettings.handle(async () => ({ theme: "dark" }));
ipc.openFile.handle(async (_event, path: string) => ({ path, text: "" }));
