# Utility processes

Four verbs type the traffic between the main process and an Electron `utilityProcess`, with request and response.

`utilityProcess` is where Electron wants CPU-heavy or crash-prone work (SQLite, indexing, native modules), and it only offers untyped `postMessage` and `process.parentPort`. The generated code types both ends:

| Verb            | Who calls                  | Main process                    | Utility process                  |
|-----------------|----------------------------|---------------------------------|----------------------------------|
| `callUtility`   | main, the child answers    | `invoke(child, ...args)`        | `handle(callback)`               |
| `notifyUtility` | main, one way              | `send(child, ...args)`          | `on(callback)`, `once(callback)` |
| `callMain`      | the child, main answers    | `handle(child, callback)`       | `invoke(...args)`                |
| `notifyMain`    | the child, one way         | `on(child, callback)`, `once(child, callback)` | `send(...args)`   |

The signature of a `callUtility` or `callMain` channel may return any value, or a promise of it. The signature of `notifyUtility` and `notifyMain` must return `void` or `Promise<void>`. The channels have no error type argument (that is for [`invokeUtility`](utility-from-renderer.md)) and no `allowedOrigins`, `validate` or `scopes` options: both ends are your own code. `callUtility` and `callMain` take `timeoutMs`, and `notifyUtility` and `notifyMain` have no options at all.

To call a utility process from a page without a hop through the main process, see [Calling a utility process from a renderer](utility-from-renderer.md).

## The generated utility.ts

Besides `main.ts`, the generator writes `utility.ts` (see `utilityBindingsPath`), with the same `ipc` object for the code that runs in the utility process. It talks over `process.parentPort`, needs no import from `electron`, and, like the other generated files, no dependency on this library. It is written only when the schema has a channel that a utility process takes part in, which includes the channels that a [page calls directly](utility-from-renderer.md).

`utility.ts` reads `process.parentPort` when a channel is first used. Importing it elsewhere is harmless, but using a channel outside a utility process fails with `TypeError: These bindings can be used only in an Electron utility process, which has process.parentPort`.

## An example

The schema declares one channel of each verb:

<!-- readme-example: kind-utility src/autoipc/schema.ts -->
```ts
import { callMain, callUtility, defineChannels, notifyMain, notifyUtility } from "automate-electron-ipc";

export default defineChannels({
   // The main process asks the child, which answers with a number.
   indexFile: callUtility<(path: string) => Promise<number>>(),
   // The main process tells the child something.
   setLogLevel: notifyUtility<(level: "debug" | "info") => void>(),
   // The child asks the main process.
   getSetting: callMain<(key: string) => Promise<string | undefined>>(),
   // The child tells the main process something.
   indexed: notifyMain<(done: number, total: number) => void>(),
});
```

In the main process, `forkUtility` forks the child and every channel takes the child as its first argument:

<!-- readme-example: kind-utility src/main/index.ts -->
```ts
import path from "node:path";
import { forkUtility, ipc } from "../autoipc/main";

const settings = new Map<string, string>([["theme", "dark"]]);

export async function startIndexer(): Promise<number> {
   // forkUtility takes the arguments of utilityProcess.fork. Do not fork the child with
   // utilityProcess.fork, unless you call attachUtility(child) right after, see below.
   const child = forkUtility(path.join(__dirname, "indexer.js"));
   ipc.getSetting.handle(child, async (key) => settings.get(key));
   ipc.indexed.on(child, (done, total) => console.log(`${done}/${total}`));
   ipc.setLogLevel.send(child, "debug");
   return ipc.indexFile.invoke(child, "/home/me/notes"); // a number
}
```

The entry file of the child is your own file, which is the path that you give to `forkUtility`. It imports the generated `utility.ts`. Build it as an entry of its own, with the same bundler setup as for the main process, and add `utility.ts` to the TypeScript project of the main process (see [TypeScript configuration](../tooling/typescript-configuration.md)):

<!-- readme-example: kind-utility src/utility/indexer.ts -->
```ts
import { ipc } from "../autoipc/utility";

let level = "info";

ipc.indexFile.handle(async (path) => {
   const theme = await ipc.getSetting.invoke("theme");
   ipc.indexed.send(1, 1);
   return `${level}:${theme}:${path}`.length;
});
ipc.setLogLevel.on((next) => {
   level = next;
});
```

The generated `main.ts` and `utility.ts` are mirror images: what one side handles or listens to, the other side calls or sends. For `indexFile`, the main process calls with the child, and the child handles:

```ts
// main.ts
indexFile: {
   invoke: (child: UtilityProcess, path: string): Promise<number> =>
      callUtilityChild(child, 'autoipc:indexFile', [path]) as Promise<number>,
},
```

```ts
// utility.ts
indexFile: {
   handle: (callback: (path: string) => Promise<number>) =>
      setUtilityHandler(getUtilityPeer(), 'autoipc:indexFile', callback),
},
```

Every `child` is a `UtilityProcess`, so any number of children can run, each with its own handlers, listeners and pending calls. The generated code keeps its state per child.

## Forking and attaching

The main process cannot ask a child whether it has exited: `pid` is `undefined` before the spawn and after the exit, and Electron drops what is posted to a child that is gone without an error. It has to see the `'exit'` event, and only a listener that was set up before the child could exit does. This listener is also what answers a child that calls the main process first.

- **Fork the child with `forkUtility(...)`.** It takes the arguments of `utilityProcess.fork`, calls it, and starts listening to the child at once.
- For a child that is forked elsewhere, call `attachUtility(child)` right after `utilityProcess.fork`, in the same tick. Calling it twice does nothing. It cannot tell that a child exited before it was called.
- A child that neither was forked by `forkUtility` nor attached is rejected. `invoke` rejects, and `send`, `handle`, `on`, `once` and `connect` (of the [channels of a page](utility-from-renderer.md)) throw an `IpcUtilityError` with `IPC_UTILITY_NOT_ATTACHED`, instead of a call that waits for a child that may be gone.
- Once a child has exited, `invoke` rejects with `IPC_UTILITY_EXITED`, `send` throws it, and so does `connect`.

`forkUtility`, `attachUtility` and `IpcUtilityError` are exported from `main.ts`. A schema that has only `invokeUtility` and `streamUtility` channels gets them in `main.ts` as well.

## Handlers and listeners

- A handler is registered per child in the main process, and a new `handle` replaces the previous one. In the child, the handler of a channel is single too.
- Each `handle`, `on` and `once` returns a function which removes that registration, and only its own: the disposer of a replaced handler does nothing.
- A listener that throws or rejects is reported to `console.error`, and the others still run. A listener that is registered twice is called twice, and each registration has its own disposer.
- The code of the child sets up its listener on `process.parentPort` when a channel is first used, and Electron queues the messages until then. A call for a channel without a handler is answered with `IPC_UTILITY_NO_HANDLER`, so register the handlers when the process starts.

## Errors

The messages are plain objects with an `__ipc` field, so other messages on the same port are left to the application. A call has an ID, and the answer is the same envelope as that of an [`invoke` channel](../channels/invoke.md#errors).

A failed call is rejected with an `IpcUtilityError`, which `main.ts` and `utility.ts` both export. It is a real `Error`, since these ends are Node processes: `contextBridge` is not involved. It has the `channel`, and the `name`, `message`, `code` and `data` of what the handler threw. The `name` is `IpcUtilityError` for the errors of the library. The stack stays in the process that threw, and `data` is left out if it cannot be cloned. The errors of `invoke` use the envelope also with `rawErrors`, since there is no Electron behavior to leave them to.

The library uses these codes. `<name>` is the name of the channel:

| Code                       | Meaning                                                                       | Message |
|----------------------------|-------------------------------------------------------------------------------|---------|
| `IPC_UTILITY_EXITED`       | the utility process exited, also while the call was pending, and any later call or send | `The utility process exited before the channel '<name>' was answered` for a pending call, `The other side of the channel '<name>' is gone` for a later call or send |
| `IPC_UTILITY_NOT_ATTACHED` | the main process was given a child that `forkUtility` or `attachUtility` never saw (main only) | `The utility process of the channel '<name>' was not attached. Fork it with forkUtility(), or call attachUtility(child) right after utilityProcess.fork()` |
| `IPC_UTILITY_NO_HANDLER`   | the other side has no handler for the channel                                 | `The other side has no handler for the channel '<name>'` |
| `IPC_UTILITY_UNSENDABLE`   | the arguments or the result cannot be cloned (a function, for example)       | `A message of the channel '<name>' cannot be sent: <reason>` |
| `IPC_UTILITY_INVALID_REPLY`| the reply had an unknown shape                                                | `The other side sent an unreadable reply` |
| `IPC_UTILITY_TIMEOUT`      | no reply arrived within `timeoutMs` (the handler is not stopped, and its late reply is dropped) | `The channel '<name>' did not answer within <ms> ms` |

## Timeouts

`callUtility` and `callMain` take `timeoutMs` (see [Timeouts](../channels/invoke.md#timeouts)), and the `timeoutMs` of the config is their default. `0` turns the timeout off for a channel. A call without a limit, whose handler never answers, waits until the process exits. A delay beyond 2147483647 ms, the longest that a timer can hold, counts as 2147483647 ms.

## Types and serializers

- The signature is checked for what structured clone cannot send, like the others. A call or a result that cannot be cloned at run time is rejected with `IPC_UTILITY_UNSENDABLE`.
- With a [serializer](../schema/custom-serializers.md), the arguments, the results and the messages of these channels go through it. A call or a send that cannot be serialized fails with an `IpcSerializationError`, and a `send` that cannot be read is logged with `console.error` and dropped.
