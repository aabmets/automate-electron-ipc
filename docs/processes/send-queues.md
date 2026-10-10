# Bounded send queues

The `send` of a [port channel](ports.md) keeps messages in a bounded queue while it has nobody to send to. The `maxQueue` option sets the limit, and an overflow callback decides which messages are dropped when the queue is full.

## When messages are queued

`send` of a `port` or `mainPort` channel queues its messages whenever there is no port to send to:

- before the page has loaded,
- after a port has closed while the contents are still alive, and
- for the channel itself in a page, while it has no connection yet.

A main process that tails a log into a window which has not loaded would otherwise hold every line in memory, so these queues are bounded. When the port arrives, the queue is sent in order, before the `onReady` callbacks run. `close()` of a connection discards its queue.

## The maxQueue option

<!-- readme-example: kind-queues src/autoipc/schema.ts -->
```ts
import { defineChannels, mainPort } from "automate-electron-ipc";

export default defineChannels({
   logTail: mainPort<(line: string) => void>({ maxQueue: 5000 }),
   meters: mainPort<(level: number) => void>({ maxQueue: 0 }), // nothing is queued
   frames: mainPort<(frame: Uint8Array) => void>({ maxQueue: Infinity }), // never drops
});
```

`maxQueue` is a non-negative integer literal, or `Infinity`, and the default is 1000. Any other value is a schema error, such as `option 'maxQueue' must be a non-negative integer literal or Infinity, found '1.5'.` A value above `Number.MAX_SAFE_INTEGER` is rejected as well: use `Infinity`.

- Messages are counted, not bytes.
- The limit applies to every queue of the channel: the queue of each connection in the preload script, the queue of the channel that waits for the first connection, and, for `mainPort`, the queue of each connection in the main process.
- With `0` nothing is queued, and every message that is sent while there is no port goes through the overflow path below.
- `Infinity` is a plain identifier, so a linter with the `useNumberNamespace` rule asks for `Number.POSITIVE_INFINITY`. The schema does not accept that form, and the rule is best disabled for the line.

## Handling overflow

A message that does not fit is handled by the overflow callback, and the oldest message is dropped when there is none. A callback is registered at run time, since the schema is only parsed, never executed. The page and the main process differ on purpose.

### In a page

The page callback gets the new message, and answers with an action:

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

| Action | Effect |
|--------|--------|
| `"dropOldest"` | drop the oldest message and queue the new one (the default) |
| `"dropNewest"` | drop the new message |
| `"clear"` | drop the whole queue and keep the new message |

A callback that throws, or returns anything else, is logged with `console.error` (`The overflow callback of the channel '<name>' must return 'dropOldest', 'dropNewest' or 'clear'` for a wrong answer), and the oldest message is dropped.

`onOverflow` returns a function which removes the callback again, and removes only its own: after a newer callback has replaced it, the older disposer does nothing. A callback on a connection (from `onConnection`) wins over the callback of the channel.

The page callback never gets the queue, because `contextBridge` copies every argument that crosses it, and a queue at its limit would be copied again for every message that is dropped.

### In the main process

The main process has no bridge, so its callback gets a copy of the queue (each message is an argument list), the new message and the counts, and returns the array of messages to keep:

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

The returned array covers dropping the oldest or the newest, coalescing and clearing. If it holds more than `maxQueue` messages, the oldest are dropped to fit. A callback that throws, or returns something else than an array of argument lists, is logged with `console.error` (`The overflow callback of the channel '<name>' must return an array of messages` for a wrong answer), and the oldest message is dropped.

`configurePorts` sets the callback of all channels, and `connection.onOverflow` the callback of one connection, which wins. Passing `undefined` goes back to the global callback. `configurePorts` is generated when the schema has a `mainPort` channel. A `port` channel queues only in the preload script of the page.

## Counts and warnings

The callbacks get `info`, with `channel`, `max`, `dropped` and `warnings`. `dropped` and `warnings` count what this queue has dropped and warned about so far, before the current message. A queue keeps its counts for as long as it exists, so a queue that drains and overflows again continues them. The messages that waited in the queue of a page channel before its first connection move to that connection, whose counts start at zero.

The first drop of a queue is logged with `console.warn`, and then every 100th drop (100, 200, ...):

```text
The send queue of the port channel 'logTail' is full (maxQueue 5000), so messages are being dropped. Dropped so far: 1. Warnings so far: 1.
```
