# Bounded send queues

The `send` of a port channel keeps messages in a bounded queue while it has nobody to send to. The limit is the `maxQueue` option, and the overflow callback decides which messages are dropped when the queue is full.

`send` of a `port` or `mainPort` channel queues its messages whenever there is no port to send to:
before the page has loaded, after a port has closed while the contents are still alive, and, for
the channel itself, while it has no connection yet. A main process that tails a log into a window
which has not loaded would otherwise hold every line in memory, so these queues are bounded:

<!-- readme-example: kind-queues src/autoipc/schema.ts -->
```ts
import { defineChannels, mainPort } from "automate-electron-ipc";

export default defineChannels({
   logTail: mainPort<(line: string) => void>({ maxQueue: 5000 }),
   meters: mainPort<(level: number) => void>({ maxQueue: 0 }), // nothing is queued
   frames: mainPort<(frame: Uint8Array) => void>({ maxQueue: Infinity }), // never drops
});
```

`maxQueue` is a non-negative integer literal, or `Infinity`, and the default is 1000. Messages are
counted, not bytes. It applies to every queue of the channel: the queue of each connection in the
preload script, the queue of the channel that waits for the first connection, and, for `mainPort`,
the queue of each connection in the main process. With `0` nothing is queued, and every message
that is sent while there is no port goes through the overflow path below. `Infinity` is a plain
identifier, so a linter with the `useNumberNamespace` rule asks for `Number.POSITIVE_INFINITY`; the
schema does not accept that form, and the rule is best disabled for the line.

A message that does not fit is handled by the overflow callback, and the oldest message is dropped
when there is none. A callback is registered at run time, since the schema is only parsed, never
executed. The page and the main process differ on purpose:

The page gets the new message, and answers with an action:

<!-- readme-example: kind-queues src/renderer/app.ts -->
```ts
const stopOverflow = ipc.logTail.onOverflow((message, info) => {
   // message: the argument list, [line]
   // info: { channel: "logTail", max: 5000, dropped: 12, warnings: 1 }
   console.log(message, info.dropped);
   return "dropOldest"; // or "dropNewest", or "clear" (drop the queue, keep the new message)
});
// On a connection from onConnection, which wins over the callback of the channel:
// connection.onOverflow(callback);
```

`onOverflow` returns a function which removes the callback again, and removes only its own: after a
newer callback has replaced it, the older disposer does nothing.

The main process gets the queue, and returns the messages to keep:

<!-- readme-example: kind-queues src/main/index.ts -->
```ts
import { app, BrowserWindow } from "electron";
import { configurePorts, ipc } from "../autoipc/main";

app.whenReady().then(() => {
   configurePorts({
      onOverflow: (queue, message, _info) => [...queue.slice(1), message], // the default of all channels
   });
   const tail = ipc.logTail.connect(new BrowserWindow());
   tail.onOverflow((queue, message, _info) => [...queue, message]); // for one connection only
   tail.onOverflow(undefined); // back to the global callback
});
```

The page callback never gets the queue, because `contextBridge` copies every argument that crosses
it, and a queue at its limit would be copied again for every message that is dropped. The main
process has no bridge, so its callback gets a copy of the queue (each message is an argument list)
and returns the array to keep, which covers dropping the oldest or the newest, coalescing and
clearing. If it returns more than `maxQueue` messages, the oldest are dropped to fit. A callback that
throws, or returns something else, is logged with `console.error` and the oldest message is dropped.
`info.dropped` and `info.warnings` count what this queue has dropped and warned about so far.

The first drop of a queue is logged with `console.warn`, and then every 100th (100, 200, ...). The
text names the channel and `maxQueue`, and gives the counts. The counts belong to the queue and are
never reset, so a queue that drains and overflows again continues them. `configurePorts` is
generated when the schema has a `mainPort` channel; a `port` channel queues only in the preload
script.


