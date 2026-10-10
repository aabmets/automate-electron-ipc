# emit channels

An `emit` channel is a message from the main process to pages that gets no answer. It is
`webContents.send` of Electron, with types. The signature returns `void` (or `Promise<void>`); the schema
generator rejects any other return type.

## Declaring, sending and receiving

<!-- readme-example: kind-emit src/autoipc/schema.ts -->
```ts
import { defineChannels, emit, send } from "automate-electron-ipc";

export default defineChannels({
   // Sent by the main process when the window gets the focus, and whenever the code asks for it.
   progress: emit<(percent: number) => void>({ trigger: "focus" }),
   theme: emit<(name: "dark" | "light") => void>(),
   search: send<(query: string) => void>(),
   searchStarted: emit<(query: string) => void>(),
});
```

In the main process, `send` takes the target, which is a window, a view, its contents or one frame, and
then the arguments of the signature. `broadcast` and `broadcastTo` send to several pages, and
`sendToSender` replies to the frame that sent a message. With a `trigger`, `bind` sends each time that
event of the window fires:

<!-- readme-example: kind-emit src/main/index.ts -->
```ts
import { app, BrowserWindow } from "electron";
import { ipc } from "../autoipc/main";

let percent = 0;

app.whenReady().then(() => {
   const mainWindow = new BrowserWindow();

   ipc.progress.send(mainWindow, 50);
   ipc.progress.send(mainWindow.webContents.mainFrame, 50);
   ipc.theme.broadcast("dark");
   ipc.theme.broadcastTo((contents) => contents.getURL().startsWith("app://settings"), "light");

   const dispose = ipc.progress.bind(mainWindow, () => [percent]);
   // Later, to stop sending on focus: dispose();

   ipc.search.on((event, query) => {
      ipc.searchStarted.sendToSender(event, query); // replies to the frame that asked
   });
});
```

In the page, `on` registers a listener for the messages of the main process. It gets the arguments of
the signature, never the Electron event, and returns a function which removes that one listener:

<!-- readme-example: kind-emit src/renderer/app.ts -->
```ts
const stopListening = ipc.progress.on((percent) => {
   document.title = `${percent}%`;
});
const stopTheme = ipc.theme.on((name) => document.body.classList.toggle("dark", name === "dark"));
ipc.search.send("electron");
// Later, to unsubscribe, such as when a component unmounts: stopListening(); stopTheme();
```

## Listening in the page

`once` delivers a single message, and returns a disposer too.

The preload script of the page shares one `ipcRenderer` listener per channel, which strips the Electron
event, and calls the subscribers in the order of subscription. A callback that throws is logged with
`console.error` and does not stop the others. The listener is added with the first subscriber and removed
with the last, so any number of subscribers causes no `MaxListenersExceededWarning`.

With a `serializer` in the config, the arguments go through it (see
[Custom serializers](../schema/custom-serializers.md)). A message that cannot be deserialized is dropped
and logged.

## Targets of an emit channel

`ipc.<name>.send(target, ...args)` takes a `BrowserWindow`, a `WebContentsView`, a `WebContents` or a
`WebFrameMain`, so a message can go to a window, to a view inside it, to its contents, or to one frame
(`ipc.progress.send(view, 50)`, `ipc.progress.send(mainWindow.webContents, 50)`; see the example above).
It throws Electron's error for a target that is destroyed, since the caller handed it over.

`sendToSender(event, ...args)` replies to the exact frame that sent the event you are handling, such
as an iframe, which a `send` to the window would not reach. It takes the event of any handler.
Electron clears `event.senderFrame` once the frame navigates or is destroyed, and `sendToSender`
reads it at the moment of the call, so call it before the first `await`; after one, the frame may
already be gone. It returns `true` when the message went out, and `false` when there was nobody to send
to: no frame, or a frame that is destroyed or detached. A reply to a sender that has gone is not an
error.

`broadcast(...args)` sends to every open `WebContents`, such as the windows and views of the app,
for something that all of them show (a theme or a setting). Contents that are destroyed are skipped.
`broadcast` covers all contents that Electron reports, DevTools included, so use
`broadcastTo(filter, ...args)` when only some of them should get the message: it sends only to the
contents that `filter` accepts. The filter comes first, because the options of a signature may end in
optional or rest parameters, which would swallow an options argument.

With `scopes`, only the pages whose preload script has the channel listen to it (see
[Scopes](../security/scopes.md)). `send`, `broadcast` and `sendToSender` do not check that: you choose the
target.

## Triggers and `bind`

The `trigger` option is the name of a `BrowserWindow` event, such as `"focus"`. A channel with a
`trigger` also has `bind(browserWindow, provider, onError?)`:

- It registers one listener for the event on the window and returns a function which removes it.
  Calling `bind` twice registers two listeners.
- Each time the event fires, it calls `provider`, which returns the argument list of the signature (or a
  promise of it), and sends that list to the contents of the window. If the window is destroyed by
  then, nothing is sent (the window of a `closed` event is always destroyed already).
- If `provider` throws or rejects, that send is skipped and later events still send. The error goes to
  `onError`, or to `console.error` without it.

```typescript
ipc.progress.bind(mainWindow, () => [currentProgress()], (error) => log.warn(error));
```

`ipc.progress.send(browserWindow, n)` always sends immediately, whether the channel has a `trigger` or
not. The schema generator accepts these events, which are the ones of the Electron documentation for
`BrowserWindow`, and rejects any other name:

??? note "All events that `trigger` accepts"
    `show`, `ready-to-show`, `app-command`, `blur`, `close`, `always-on-top-changed`, `closed`, `enter-full-screen`, `enter-html-full-screen`, `focus`, `hide`, `leave-full-screen`, `leave-html-full-screen`, `maximize`, `minimize`, `move`, `moved`, `new-window-for-tab`, `page-title-updated`, `persisted-state-restored`, `query-session-end`, `resize`, `resized`, `responsive`, `restore`, `rotate-gesture`, `session-end`, `sheet-begin`, `sheet-end`, `swipe`, `system-context-menu`, `unmaximize`, `unresponsive`, `will-move`, `will-resize`.

## What the library generates

The main process sends with the target that the caller hands over, and the preload script of the page
subscribes (both abridged):

```ts
// main.ts
progress: {
   send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, percent: number) =>
      resolveSendTarget(target).send('autoipc:progress', percent),
   sendToSender: (event: { readonly senderFrame: WebFrameMain | null }, percent: number) =>
      sendToSenderFrame(event, 'autoipc:progress', [percent]),
   broadcast: (percent: number) =>
      broadcastMessage('autoipc:progress', [percent]),
   broadcastTo: (filter: (contents: WebContents) => boolean, percent: number) =>
      broadcastMessage('autoipc:progress', [percent], filter),
   bind: (browserWindow: BrowserWindow, provider: () => [percent: number] | Promise<[percent: number]>, onError?: (error: unknown) => void) => {
      // ...
      browserWindow.on("focus", listener);
      return () => {
         browserWindow.off("focus", listener);
      };
   },
},
```

```ts
// preload.ts
progress: {
   on: (callback: Function) => {
      return listenToChannel('autoipc:progress', callback, false);
   },
   once: (callback: Function) => {
      return listenToChannel('autoipc:progress', callback, true);
   },
},
```

## Options

| Option | Meaning |
|---|---|
| `trigger` | The `BrowserWindow` event that `bind` listens to (see [Triggers and `bind`](#triggers-and-bind)). |
| `scopes` | The windows that have the channel (see [Scopes](../security/scopes.md)). |
