# ask channels

Electron has no invoke from the main process to a page. An `ask` channel adds one, for questions such as
"are there unsaved changes?" when a window closes. The signature takes the arguments of the question and
returns the answer, as a value or a promise. Unlike `invoke`, a question can be turned down in several
ways (the page is gone, has no responder, or is too slow), so read [Errors](#errors) and
[Timeouts](#timeouts).

## Declaring, asking and answering

<!-- readme-example: kind-ask src/autoipc/schema.ts -->
```ts
import { ask, defineChannels } from "automate-electron-ipc";

export default defineChannels({
   hasUnsavedChanges: ask<(documentId: number) => boolean>(),
});
```

The main process asks with `invoke(target, ...args)` and gets a promise of the answer. The target is a
window, a view, its contents or one frame, the same as for the `send` of an [emit](emit.md) channel:

<!-- readme-example: kind-ask src/main/index.ts -->
```ts
import { app, BrowserWindow } from "electron";
import { ipc } from "../autoipc/main";

const currentDocument = 1;

app.whenReady().then(() => {
   const window = new BrowserWindow();
   window.on("close", async (event) => {
      event.preventDefault();
      const unsaved = await ipc.hasUnsavedChanges.invoke(window, currentDocument);
      if (!unsaved) window.destroy();
   });
});
```

The page registers one responder per channel with `handle`. The responder gets the arguments of the
question, never an Electron event. It returns what the signature returns, so a signature with a `Promise`
return type lets it answer later:

<!-- readme-example: kind-ask src/renderer/app.ts -->
```ts
const editor = { isDirty: (_documentId: number) => false };

const dispose = ipc.hasUnsavedChanges.handle((documentId) => editor.isDirty(documentId));
```

## Responders

A page has a single responder per channel. Calling `handle` again replaces the previous one, and the
function that `handle` returns removes only its own responder: the disposer of a replaced responder does
nothing. The preload script listens from the start, so a question that arrives while no responder is
registered is answered with `IPC_ASK_NO_HANDLER` at once, and not left to time out.

A window that does not have the channel at all never answers: a window of another scope (see
[Scopes](../security/scopes.md)), or a page without the preload script. Its question waits for the
timeout, or until the page is gone.

## Errors

The promise rejects with an `IpcAskError`, a class that the generated `main.ts` exports. It has the
`name`, the `message`, the `channel` and a `code`:

| `code` | When | Message |
|---|---|---|
| `IPC_ASK_TIMEOUT` | the page has not answered within `timeoutMs` | `The renderer did not answer the channel '<channel>' within <timeoutMs> ms` |
| `IPC_ASK_DESTROYED` | the target is destroyed, its renderer process is gone or crashed, the page that was asked is replaced by a reload or a navigation, or the frame is detached | `The renderer that was asked on the channel '<channel>' is gone` |
| `IPC_ASK_NO_HANDLER` | the page has no responder registered, such as before the page has registered it | `No handler is registered for the channel '<channel>'` |
| `IPC_ASK_INVALID_REPLY` | the reply is not an answer or an error, or a serialized answer cannot be read | `The renderer sent an unreadable reply`, or `The answer cannot be read: <reason>` |
| `IPC_ASK_UNSENDABLE` | the answer of the responder cannot be sent (it cannot be cloned) | `The answer of the channel '<channel>' cannot be sent: <reason>` |

If the responder throws, the promise rejects with an `IpcAskError` which has the `name`, `message`,
`code` and `data` of that error, in the form of the errors of `invoke` channels (see
[Errors](invoke.md#errors)). The page should throw a plain object, `{ name, message, code, data }`, if it
wants more than the message to arrive: `contextBridge` copies an `Error` thrown by the page with its
message only. The `rawErrors` option does not apply to `ask`, since the answers do not travel through
Electron's own `invoke`.

A target that cannot be asked rejects the promise, and never throws. That includes a `BrowserWindow` that
was destroyed before the question, whose `webContents` getter throws in Electron: it rejects with
`IPC_ASK_DESTROYED` too. If Electron fails to send the question (an argument cannot be cloned, for
example), the promise rejects with Electron's own error. Only `ask` promises not to throw; the verbs that
return nothing (`send` of an `emit` channel, and `connect` of the port verbs) throw Electron's own error
for such a window, since the caller handed over a target that is gone.

### A question belongs to one document

A question belongs to the document that it was sent to. If that document is replaced before it answers,
the promise rejects with `IPC_ASK_DESTROYED` at once, and does not wait for a timeout:

- For contents (or a window, or a view), when a navigation of the main frame commits (`did-navigate`,
  which a reload also emits, but a navigation inside the page, such as a change of the hash, does not).
- For a frame, when that frame navigates, or when the main frame does, since that replaces every frame
  below it (`did-frame-navigate`).

The commit is what counts, not the start, so the old page can still answer while a navigation is pending,
and a navigation that `beforeunload` cancels changes nothing. A question to contents whose renderer has
crashed, or to a frame that is destroyed or detached, rejects at once, without being sent. The reply
counts only when it comes from the contents (and the frame) that were asked, so another renderer cannot
answer for them, and only the first reply counts.

## Timeouts

There is no timeout unless one is given, and the `timeoutMs` of the config does not apply to `ask`. To
bound the wait, use `invokeWith(target, { timeoutMs }, ...args)`:

```typescript
const unsaved = await ipc.hasUnsavedChanges.invokeWith(window, { timeoutMs: 3000 }, currentDocument);
```

The options come before the arguments, because the signature may end in optional or rest parameters,
which would swallow trailing options.

- `timeoutMs` is in milliseconds. A delay beyond 2147483647 ms, the longest that a timer can hold, counts
  as 2147483647 ms.
- `Infinity` waits for ever. **`0` is not "no limit", as it is for `invoke`**: the question times out
  at once.
- A `timeoutMs` that is not a non-negative number rejects the promise with a `TypeError` whose message is
  `timeoutMs must be a number which is not negative`.
- A reply that comes after the timeout is ignored.
- A frame has no event for its own destruction, so a frame that goes away after the question was sent is
  detected through its contents or the timeout, which is why a timeout is worth setting for frames.

## Options

The only option of `ask` is `scopes` (see [Scopes](../security/scopes.md)). With a `serializer` in the
config, the arguments of the question and the answer go through it (see
[Custom serializers](../schema/custom-serializers.md)).

## What the library generates

The preload script of the page keeps the responder (abridged):

```ts
// preload.ts
hasUnsavedChanges: {
   handle: (callback: Function) => {
      askHandlers['hasUnsavedChanges'] = callback;
      return () => {
         if (askHandlers['hasUnsavedChanges'] === callback) {
            delete askHandlers['hasUnsavedChanges'];
         }
      };
   },
},
```

The main process sends the question to the target that it is given. The request carries a correlation ID,
and the page answers on a reply channel, named like the channel with `:reply` behind it, with the same ID:

```ts
// main.ts
hasUnsavedChanges: {
   invoke: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, documentId: number): Promise<Awaited<boolean>> =>
      askRenderer('hasUnsavedChanges', 'autoipc:hasUnsavedChanges', 'autoipc:hasUnsavedChanges:reply', target, [documentId]) as Promise<Awaited<boolean>>,
   invokeWith: /* the same, with the options before the arguments */,
},
```
