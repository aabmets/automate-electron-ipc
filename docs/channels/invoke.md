# invoke channels

An `invoke` channel is a request from a page to the main process that is answered with a value. It is
`ipcRenderer.invoke` and `ipcMain.handle` of Electron, with types, and with errors that keep their class
name and code. The signature takes the arguments of the call and returns the answer, as a value or a
promise.

## Declaring, handling and calling

<!-- readme-example: kind-invoke src/autoipc/schema.ts -->
```ts
import { defineChannels, invoke } from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
});
```

In the main process, `handle` registers the handler, which gets the Electron event first and then the
arguments of the signature:

<!-- readme-example: kind-invoke src/main/index.ts -->
```ts
import { app } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   const dispose = ipc.getUser.handle(async (_event, id) => ({ id, name: `User ${id}` }));
   // Later, to remove the handler: dispose();
});
```

In the page, `invoke` sends the request and returns a promise of the answer:

<!-- readme-example: kind-invoke src/renderer/app.ts -->
```ts
async function showUser(): Promise<void> {
   const user = await ipc.getUser.invoke(7);
   document.title = user.name;
}

showUser();
```

## Handlers

`handle` and `handleOnce` return a function which removes that registration (`ipcMain.removeHandler`).
`handleOnce` serves a single call: the first call removes the handler before it runs. With a `validate`
option, it is used up by the first call that is valid.

An `invoke` channel has one handler. Registering `handle` or `handleOnce` again replaces the previous
handler, instead of throwing as `ipcMain.handle` does, so that re-creating a window or hot-restarting the
main process works. The disposer of a replaced handler does nothing.

A call to a channel with no registered handler fails with Electron's own error, which says that no handler
is registered for `'autoipc:getUser'`.

A handler can also be registered for the contents of one window (see
[Handlers for one window](send.md#handlers-for-one-window)).

## Options

| Option | Meaning |
|---|---|
| `timeoutMs` | The time limit of the call (see [Timeouts](#timeouts)). |
| `allowedOrigins` | The origins that may call the channel (see [Sender validation](../security/sender-validation.md)). |
| `validate` | A schema of the arguments (see [Validating arguments](../security/validating-arguments.md)). |
| `scopes` | The windows that have the channel (see [Scopes](../security/scopes.md)). |

A second type argument declares the errors of the handler (see [Errors](#errors)).

## What the library generates

The generated code is abridged below. You do not write it, but it explains the behavior that follows.

The preload script of the page forwards the call, and unwraps the answer of the main process:

```ts
// preload.ts
getUser: {
   invoke: async (...args: any[]) => {
      const result = await ipcRenderer.invoke('autoipc:getUser', ...args);
      if (result.ok) {
         return result.value;
      }
      throw result.error;
   },
},
```

The handler of the main process is wrapped to answer with `{ ok: true, value }` or
`{ ok: false, error }` (see [Errors](#errors)), and checks the sender before it runs:

```ts
// main.ts
getUser: {
   handle: (callback: (event: IpcMainInvokeEvent, id: number) => Promise<User>, options?: IpcListenOptions) => {
      // ...
      const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>
         settleInvoke(() => (handler as (...rest: unknown[]) => unknown)(event, ...rest));
      target.ipc.removeHandler('autoipc:getUser');
      target.ipc.handle('autoipc:getUser', listener);
      // ...
      return remove;
   },
   handleOnce: /* the same, and the handler removes itself before it runs */,
},
```

## Errors

Electron reports an error that an `invoke` handler throws to the renderer as the text
`Error invoking remote method 'getUser': Error: not found`. The class, the `code` and any other
field are lost. The generated bindings keep them: the main process answers every `invoke` with
`{ ok: true, value }` or `{ ok: false, error }`, and the renderer's `ipc.<name>.invoke` returns the
value or rejects with the error. Declare the errors that a handler may throw in a second type argument
of `invoke`; they are documented in the generated `types.ts`. The second type argument needs the generic
form of the signature: the `as` form cannot declare error types (see [The as form](../schema/as-form.md)).

<!-- readme-example: kind-errors src/errors.ts -->
```ts
export class NotFoundError extends Error {
   readonly name = "NotFoundError";
   readonly code = "NOT_FOUND";
   constructor(readonly data: { id: number }) {
      super("User not found");
   }
}

export class AuthError extends Error {
   readonly name = "AuthError";
   readonly code = "UNAUTHORIZED";
}
```

<!-- readme-example: kind-errors src/autoipc/schema.ts -->
```ts
import { defineChannels, invoke } from "automate-electron-ipc";
import type { AuthError, NotFoundError } from "../errors";

export interface User {
   id: number;
   name: string;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>, NotFoundError | AuthError>(),
});
```

<!-- readme-example: kind-errors src/main/index.ts -->
```ts
import { app } from "electron";
import { ipc } from "../autoipc/main";
import { NotFoundError } from "../errors";

app.whenReady().then(() => {
   ipc.getUser.handle(async (_event, id) => {
      throw new NotFoundError({ id });
   });
});
```

The global type `IpcError<E>` describes the object that the promise is rejected with. It follows the
`name`, `code` and `data` types of the declared classes, so give them literal types, as the classes above
do with `readonly name = "NotFoundError"`, to tell them apart by `name`:

<!-- readme-example: kind-errors src/renderer/app.ts -->
```ts
import type { AuthError, NotFoundError } from "../errors";

async function showUser(): Promise<void> {
   try {
      await ipc.getUser.invoke(7);
   } catch (error) {
      // { name: "NotFoundError", message: "User not found", code: "NOT_FOUND", data: { id: 7 } }
      const failure = error as IpcError<NotFoundError | AuthError>;
      if (failure.name === "NotFoundError") {
         console.log(failure.data.id); // typed from NotFoundError
      }
   }
}

showUser();
```

### What the rejection value is

The rejection value is a plain object with `name`, `message`, and, when the thrown error has them,
`code` (a string or a number) and `data`. It is not an `Error` and has no stack, since `contextBridge`
copies a thrown `Error` with only its message and stack, and so loses `name`, `code` and `data`.
Check `error.name` or `error.code` instead of `instanceof`.

- `data` is copied with the structured clone algorithm, and is left out when it cannot be cloned (it
  holds a function, for example).
- A `name` that is missing or empty becomes `"Error"`.
- Anything that is thrown but is not an object, such as a string, becomes the `message`.

### Errors of the library

A call can also be rejected before or instead of the handler. These errors have the same shape:

| `code` | `name` | When |
|---|---|---|
| `IPC_FORBIDDEN` | `IpcForbiddenError` | The sender is not allowed: its origin is not in `allowedOrigins`, its window is not in a scope of the channel, or `validateSender` refused it. The message is `The sender of the message is not allowed to use the channel '<channel>'`. See [Sender validation](../security/sender-validation.md). |
| `IPC_VALIDATION` | `IpcValidationError` | The arguments do not match the `validate` schema. The message is `The arguments of the channel '<channel>' are invalid: ` and the messages of the issues, joined with `; `, and `data` lists the issues as `{ message, path? }`. See [Validating arguments](../security/validating-arguments.md). |
| `IPC_TIMEOUT` | `IpcTimeoutError` | The channel has a time limit and the handler did not answer in time (see [Timeouts](#timeouts)). |
| `IPC_SERIALIZATION` | `IpcSerializationError` | The config names a `serializer`, and it failed (see [Custom serializers](../schema/custom-serializers.md)). |

Set `rawErrors` to `true` in the config to turn all of this off: handlers then answer with their value
and Electron reports their errors as it always did. Only the timeout still rejects with its plain object.

## Timeouts

A handler that never answers leaves the promise of `ipc.<name>.invoke` pending for ever. Give a
channel a time limit with `timeoutMs`, or set a default for all `invoke` channels with the `timeoutMs`
option of the config (`0`, which means no limit, by default; see
[Configuration](../tooling/configuration.md)):

<!-- readme-example: kind-timeouts src/autoipc/schema.ts -->
```ts
import { defineChannels, invoke } from "automate-electron-ipc";

export default defineChannels({
   exportAll: invoke<() => Promise<string>>({ timeoutMs: 30_000 }),
   // `0` turns the timeout off for this channel, also when the config sets a default.
   waitForUser: invoke<() => Promise<boolean>>({ timeoutMs: 0 }),
});
```

When the time has passed without a reply, the preload script rejects the promise with a plain object,
like the other errors of the library, and `types.ts` documents it as `IpcTimeoutError`. Its message is
`The channel '<channel>' did not answer within <timeoutMs> ms`:

<!-- readme-example: kind-timeouts src/renderer/app.ts -->
```ts
async function exportAll(): Promise<void> {
   try {
      await ipc.exportAll.invoke();
   } catch (error) {
      const failure = error as IpcError<IpcTimeoutError>;
      if (failure.code === "IPC_TIMEOUT") {
         console.log("The export took too long");
      }
   }
}

exportAll();
```

Things to know:

- Only the wait of the page ends. The handler in the main process keeps running, since it cannot be
  stopped from the renderer, and its late reply is dropped.
- `timeoutMs` is a non-negative integer literal in the schema. A delay beyond 2147483647 ms, the longest
  that a timer can hold, counts as 2147483647 ms.
- It applies to `invoke` only: a `send` has no reply, and `ask` has its own `timeoutMs` in
  [`invokeWith`](ask.md#timeouts). A `stream` has no time limit.

### Timeouts of other callers

The calls to and from a utility process (see [Utility processes](../processes/utility-processes.md)) take
the same option: `callUtility`, `callMain` and `invokeUtility` reject with an `IpcUtilityError` of the code
`IPC_UTILITY_TIMEOUT` (for the page, the plain object of the same shape), and the default of the config
applies to them. A `streamUtility` takes `timeoutMs` as well, but only as the wait for its first chunk, its
end or an error, and the default of the config does not apply to it: a timed-out stream is cancelled in the
child and fails the read of the page. The handler of a call is not stopped, and its late reply is dropped.

`invokeFromWorker` (see [Service workers](../processes/service-workers.md)) takes `timeoutMs` too, and the
default of the config applies to it. The preload script of a service worker has no timers (`setTimeout` is
not defined there), so the main process times the call: from the moment it arrives, over the schema of
`validate` and the handler. The worker gets the plain object
`{ name: "IpcTimeoutError", message, code: "IPC_TIMEOUT" }`. The handler is not stopped, and its late reply
is dropped. With `rawErrors` the main process still rejects the call, but the worker gets the error of
Electron, and the typings do not declare `IpcTimeoutError`. A question to a worker, `askWorker`, has no
schema option: `invokeWith(worker, { timeoutMs }, ...args)` times it.
