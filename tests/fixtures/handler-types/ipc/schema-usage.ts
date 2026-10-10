// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the generated types are wrong.
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { ipc as mainIpc } from "./main";

mainIpc.getUser.handle((event: IpcMainInvokeEvent, id: number) =>
   Promise.resolve(`${event.sender.id}:${id}`),
);
mainIpc.echo.on((event: IpcMainEvent, text: string, ...rest: number[]) => {
   event.reply("echoed", text, rest);
});

type IsPromise<T> = T extends Promise<unknown> ? true : false;

// Broadcast senders return nothing, since `ipcRenderer.send` returns `undefined`.
export const echoIsPromise: IsPromise<ReturnType<typeof window.ipc.echo.send>> = false;
export const pingIsPromise: IsPromise<ReturnType<typeof ipc.ping.send>> = false;
export const userResult: Promise<string> = window.ipc.getUser.invoke(1);
