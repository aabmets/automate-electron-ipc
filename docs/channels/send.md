# send channels

A `send` channel is a message from a page to the main process that gets no answer. It is
`ipcRenderer.send` and `ipcMain.on` of Electron, with types. The signature returns `void` (or
`Promise<void>`); the schema generator rejects any other return type.

## Declaring, listening and sending

<!-- readme-example: kind-send src/autoipc/schema.ts -->
```ts
import { defineChannels, send } from "automate-electron-ipc";

export default defineChannels({
   logLine: send<(level: "info" | "warn", line: string) => void>(),
});
```

In the main process, `on` registers a listener, which gets the Electron event first, and `once` a
listener that serves a single message:

<!-- readme-example: kind-send src/main/index.ts -->
```ts
import { app } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   const dispose = ipc.logLine.on((event, level, line) => {
      console.log(`[${level}] ${line} (from ${event.sender.id})`);
   });
   // Later, to remove the listener: dispose();
});
```

In the page, `send` sends the message at once:

<!-- readme-example: kind-send src/renderer/app.ts -->
```ts
ipc.logLine.send("info", "The page has loaded");
```

## Listeners

`on` and `once` return a function which removes that registration (`ipcMain.off`). Unlike `invoke`, a
`send` channel can have any number of listeners, as `ipcMain.on` can. A `once` listener removes itself
before its callback runs. With a `validate` option it is used up by the first call that is valid, and a
message that cannot be read does not use it up.

The callbacks of `on` and `once` receive the Electron event first, then the arguments of the signature.

## What the library generates

The generated code of the page is one line, and the one of the main process registers and guards the
listener (abridged):

```ts
// preload.ts
logLine: {
   send: (...args: any[]) => ipcRenderer.send('autoipc:logLine', ...args),
},
```

```ts
// main.ts
logLine: {
   on: (callback: (event: IpcMainEvent, level: "info" | "warn", line: string) => void, options?: IpcListenOptions) => {
      const guard = (event: IpcMainEvent) => isSenderAllowed(event, 'logLine');
      // ...
      const listener = (event: IpcMainEvent, level: "info" | "warn", line: string) => {
         if (!guard(event)) {
            return;
         }
         return callback(event, level, line);
      };
      target.ipc.on('autoipc:logLine', listener);
      // ...
      return remove;
   },
   once: /* the same, and the listener removes itself before the callback runs */,
},
```

## Options and failures

The options of `send` are `allowedOrigins` and `validate` (see
[Sender validation](../security/sender-validation.md) and
[Validating arguments](../security/validating-arguments.md)), and `scopes` (see
[Scopes](../security/scopes.md)).

A `send` has no answer, so the page is not told that a message was rejected:

- A message from a sender that is not allowed, or with invalid arguments, is dropped, and the
  `onRejected` hook of `configureIpc` hears of it.
- With a `serializer` in the config, the arguments go through it (see
  [Custom serializers](../schema/custom-serializers.md)). A failure to serialize makes
  `ipc.<name>.send` throw an error whose message starts with `[IPC_SERIALIZATION]`, since a function that
  throws in the page reaches the caller with the message only. A message that cannot be deserialized in
  the main process is dropped and logged with `console.error`.

## Handlers for one window

Every `on`, `once`, `handle` and `handleOnce` of a channel that a page calls (also the `handle` of a
`stream` channel) takes a second argument, `{ webContents }`. With it, the registration is made on
`webContents.ipc` of those contents instead of on the global `ipcMain`, so a window that keeps its own
state does not have to look it up by `event.sender.id`:

<!-- readme-example: kind-window-handlers src/autoipc/schema.ts -->
```ts
import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getDocument: invoke<() => Promise<string>>(),
   documentEdited: send<(text: string) => void>(),
});
```

<!-- readme-example: kind-window-handlers src/main/index.ts -->
```ts
import type { BrowserWindow } from "electron";
import { ipc } from "../autoipc/main";

export function openDocument(win: BrowserWindow, text: string): void {
   let document = text;
   ipc.getDocument.handle(async () => document, { webContents: win.webContents });
   ipc.documentEdited.on(
      (_event, edited) => {
         document = edited;
      },
      { webContents: win.webContents },
   );
}
```

The second argument has the type `IpcListenOptions`, which the generated `main.ts` exports. The
registration returns a disposer as usual, and removes itself when the contents are destroyed (the
disposer can be called afterwards without harm). Contents that are already destroyed throw a
`TypeError` with the message `Object has been destroyed`, because nothing would ever reach them. All the
registrations of some contents share one `destroyed` listener.

Electron dispatches a message from a page first to `webContents.ipc` and then to `ipcMain`:

- An `invoke` is answered by the first of the two that has a handler, so a handler of the contents
  wins over the global one for that page, and the global handler still serves the other pages. A
  channel can have one handler on each target, and `handle` replaces only the handler of its own
  target.
- A `send` goes to the listeners of both, so a global `on` still hears a message that a listener of
  the contents heard. Register on the contents only when the global listener does not need to run
  for that page.

The checks that apply to the channel (`allowedOrigins`, `scopes`, the `validateSender` hook of
`configureIpc`, and `validate`) run for the registrations of the contents as well. Frame-scoped handlers
(`webFrameMain.ipc`) are not generated.

