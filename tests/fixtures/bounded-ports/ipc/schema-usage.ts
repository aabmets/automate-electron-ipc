// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when a channel exposes the wrong overflow callbacks.
import type { BrowserWindow } from "electron";
import { configurePorts, ipc as mainIpc, type PortOverflowInfo } from "./main";

declare const win: BrowserWindow;

// Main: the global default gets the queue as it is, and returns the messages to keep.
configurePorts({
   onOverflow: (queue, message, info) => {
      console.log(info.channel, info.max, info.dropped, info.warnings);
      return [...queue.slice(1), message];
   },
});
configurePorts({});
export const info: PortOverflowInfo = { channel: "logTail", max: 3, dropped: 0, warnings: 0 };

// Main: the override of a connection is typed with the signature of the channel.
export const connection = mainIpc.logTail.connect(win);
export const removeOverride: () => void = connection.onOverflow((queue, message, info) => {
   const line: string = message[0];
   const level: number | undefined = message[1];
   console.log(line, level, info.dropped, queue.length);
   return queue.filter(([earlier]) => earlier !== line);
});
connection.onOverflow(undefined);
removeOverride();

// @ts-expect-error the callback returns the messages to keep, not an action
connection.onOverflow(() => "dropOldest");
// @ts-expect-error the messages of the queue are typed with the signature
connection.onOverflow((queue) => [[1], ...queue]);
// @ts-expect-error the callback is not optional to pass
connection.onOverflow();

// Renderer: the callback gets only the new message, and answers with an action.
export const stopChannel: () => void = ipc.logTail.onOverflow((message, info) => {
   const line: string = message[0];
   console.log(line, info.channel, info.max, info.dropped, info.warnings);
   return info.dropped > 10 ? "clear" : "dropOldest";
});
ipc.chat.onOverflow(() => "dropNewest");
ipc.logTail.onConnection((peer) => {
   const stop: () => void = peer.onOverflow(() => "clear");
   stop();
   // @ts-expect-error an action is one of three strings
   peer.onOverflow(() => "dropEverything");
});
// @ts-expect-error the callback gets the new message, which is typed with the signature
ipc.chat.onOverflow((message: [number]) => (message ? "clear" : "dropOldest"));
// @ts-expect-error the callback must answer with an action
ipc.chat.onOverflow(() => undefined);
// @ts-expect-error the callback is not optional to pass
ipc.chat.onOverflow();
