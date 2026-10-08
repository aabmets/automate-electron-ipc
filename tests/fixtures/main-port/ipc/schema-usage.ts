// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when a channel exposes the wrong methods.
import type { BrowserWindow, WebContents, WebContentsView } from "electron";
import { ipc as mainIpc } from "./main";

declare const win: BrowserWindow;
declare const contents: WebContents;
declare const view: WebContentsView;

// Main: a connection is made for one window, view or contents.
export const connection = mainIpc.logTail.connect(win);
mainIpc.logTail.connect(contents);
mainIpc.logTail.connect(view);
connection.send("line");
connection.send("line", 2);
export const stopMessages: () => void = connection.on((line: string, level?: number) => {
   console.log(line, level);
});
export const stopReady: () => void = connection.onReady(() => connection.send("ready"));
export const stopClose: () => void = connection.onClose(() => undefined);
stopMessages();
connection.close();

// @ts-expect-error the messages of the connection are typed like the channel
connection.send(1);
// @ts-expect-error the callback of on takes the arguments of the signature
connection.on((line: number) => line);
// @ts-expect-error the callback of onReady takes no arguments
connection.onReady((line: string) => line);
// @ts-expect-error a connection is made for one target
mainIpc.logTail.connect(win, win);
// @ts-expect-error a port channel with the main process has no send of its own
mainIpc.logTail.send("line");
// @ts-expect-error the target is a window, a view or contents
mainIpc.logTail.connect("window");

// Renderer: the API is that of a port channel.
ipc.logTail.send("line");
export const stopTail: () => void = ipc.logTail.on((line: string) => console.log(line));
ipc.logTail.onReady(() => ipc.logTail.send("ready", 1));
ipc.logTail.onClose(() => undefined);
export const stopConnections: () => void = ipc.logTail.onConnection((peer) => {
   peer.send("welcome");
   peer.on((line: string) => console.log(line));
   peer.close();
   // @ts-expect-error the messages of a connection are typed like the channel
   peer.send(1);
});
// @ts-expect-error the main process connects the windows
ipc.logTail.connect(win);
