# emit

An `emit` channel is a message from the main process to pages that gets no answer, which is
`webContents.send` of Electron with types. The signature returns `void` (or `Promise<void>`).

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
then the arguments of the signature. With a `trigger`, `bind` sends each time that event of the window
fires:

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

`once` delivers a single message, and returns the disposer too. The preload script of the page shares
one `ipcRenderer` listener per channel, which strips the Electron event, and calls the subscribers in
the order of subscription (a callback that throws is logged and does not stop the others). The listener
is added with the first subscriber and removed with the last, so any number of subscribers causes no
`MaxListenersExceededWarning`. The main process sends with the target that the caller hands over (the
code below is abridged):

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

The options of `emit` are `trigger` and `scopes` (see [Scopes](../security/scopes.md)). The `trigger` is
the name of a `BrowserWindow` event, such as `"focus"`; the schema accepts the events of the Electron
documentation, among them `show`, `ready-to-show`, `blur`, `close`, `closed`, `focus`, `hide`,
`maximize`, `minimize`, `move`, `moved`, `resize`, `resized`, `restore`, `unmaximize` and the full-screen
events. `ipc.progress.send(browserWindow, n)` always sends immediately, and a channel with a
`trigger` also has `bind(browserWindow, provider)`. It registers one listener for the event, calls
`provider` each time the event fires, sends the argument list that `provider` returns (or resolves to)
to the contents of the window, unless the window is destroyed by then, and returns a function which
removes the listener. If `provider` throws or rejects, that send is
skipped and later events still send. The error goes to the optional third argument,
`(error: unknown) => void`, or to `console.error` without it:

```typescript
ipc.progress.bind(mainWindow, () => [currentProgress()], (error) => log.warn(error));
```

## Targets of an emit channel

`ipc.<name>.send(target, ...args)` takes a `BrowserWindow`, a `WebContentsView`, a `WebContents` or a
`WebFrameMain`, so a message can go to a window, to a view inside it, to its contents, or to one frame
(`ipc.progress.send(view, 50)`, `ipc.progress.send(mainWindow.webContents, 50)`; see the example above).

`sendToSender(event, ...args)` replies to the exact frame that sent the event you are handling, such
as an iframe, which a `send` to the window would not reach. It takes the event of any handler.
Electron clears `event.senderFrame` once the frame navigates or is destroyed, and `sendToSender`
reads it at the moment of the call, so call it before the first `await`; after one, the frame may
already be gone. It returns `true` when the message went out, and `false` when there was nobody to send
to: no frame, or a frame that is destroyed or detached. Unlike `send`, which throws for a target
that the caller handed over and that is destroyed, a reply to a sender that has gone is not an error.

`broadcast(...args)` sends to every open `WebContents`, such as the windows and views of the app,
for something that all of them show (a theme or a setting). Contents that are destroyed are skipped.
`broadcastTo(filter, ...args)` sends only to the contents that `filter` accepts.
`broadcast` covers all contents that Electron reports, DevTools included, so use `broadcastTo` when
only some of them should get the message. The filter comes first, because the options of a signature
may end in optional or rest parameters, which would swallow an options argument. `send` still throws
for a target that is destroyed, since the caller handed it over.

