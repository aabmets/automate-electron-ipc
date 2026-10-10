# Utility processes

Typed channels between the main process and an Electron `utilityProcess`.

`utilityProcess` is where Electron wants CPU-heavy or crash-prone work (SQLite, indexing, native
modules), and it only offers untyped `postMessage` and `process.parentPort`. Four verbs type the
traffic between the main process and a utility process, with request and response:

| Verb            | Who calls                  | Main process                    | Utility process                  |
|-----------------|----------------------------|---------------------------------|----------------------------------|
| `callUtility`   | main, the child answers    | `invoke(child, ...args)`        | `handle(callback)`               |
| `notifyUtility` | main, one way              | `send(child, ...args)`          | `on(callback)`, `once(callback)` |
| `callMain`      | the child, main answers    | `handle(child, callback)`       | `invoke(...args)`                |
| `notifyMain`    | the child, one way         | `on(child, callback)`, `once(child, callback)` | `send(...args)`   |

Besides `main.ts`, the generator writes `utility.ts` (see `utilityBindingsPath`), with the same
`ipc` object for the code that runs in the utility process. It talks over `process.parentPort`, needs
no import from `electron`, and, like the other generated files, no dependency on this library. It is
written only when the schema has a channel that a utility process takes part in, which includes the
channels that a [page calls directly](utility-from-renderer.md).

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

In the main process, `forkUtility` forks the child and every channel takes the child as its first
argument:

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

The entry file of the child imports the generated `utility.ts`:

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

The generated `main.ts` and `utility.ts` are mirror images: what one side handles or listens to, the
other side calls or sends. For `indexFile`, the main process calls with the child, and the child handles:

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

Every `child` is a `UtilityProcess`, so any number of children can run, each with its own handlers,
listeners and pending calls. The generated code keeps its state per child.

The messages are plain objects with an `__ipc` field, so other messages on the same port are left to the
application. A call has an ID, and the answer is the same envelope as that of an `invoke` channel. A
call is rejected with an `IpcUtilityError`, which `main.ts` and `utility.ts` both export. It is a
real `Error`, since these ends are Node processes: `contextBridge` is not involved. It has the `name`,
`message`, `code` and `data` of what the handler threw, and `channel`. The library uses these codes:

| Code                       | Meaning                                                                       |
|----------------------------|-------------------------------------------------------------------------------|
| `IPC_UTILITY_EXITED`       | the utility process exited, also while the call was pending, and any later call or send |
| `IPC_UTILITY_NOT_ATTACHED` | the main process was given a child that `forkUtility` or `attachUtility` never saw (main only) |
| `IPC_UTILITY_NO_HANDLER`   | the other side has no handler for the channel                                 |
| `IPC_UTILITY_UNSENDABLE`   | the arguments or the result cannot be cloned (a function, for example)       |
| `IPC_UTILITY_INVALID_REPLY`| the reply had an unknown shape                                                |
| `IPC_UTILITY_TIMEOUT`      | no reply arrived within `timeoutMs` (the handler is not stopped, and its late reply is dropped) |

A few things to know:
 - A handler is registered per child in the main process, and replaces the previous one. Each `handle`,
   `on` and `once` returns a function which removes that registration. A listener that throws or
   rejects is reported to `console.error`, and the others still run. A listener that is registered
   twice is called twice, and each registration has its own disposer.
 - The code of the child sets up its listener on `process.parentPort` when a channel is first used, and
   Electron queues the messages until then. A call for a channel without a handler is answered with
   `IPC_UTILITY_NO_HANDLER`, so register the handlers when the process starts.
 - **Fork the child with `forkUtility(...)`**, which takes the arguments of `utilityProcess.fork`, calls
   it and starts listening to the child at once. The main process cannot ask a child whether it has
   exited (`pid` is `undefined` before the spawn and after the exit, and Electron drops what is posted to a
   child that is gone without an error), so it has to see the `'exit'` event, and only a listener that was
   set up before the child could exit does. This is also what answers a child that calls the main process
   first. For a child that is forked elsewhere, call `attachUtility(child)` right after
   `utilityProcess.fork`, in the same tick; calling it twice does nothing. It cannot tell that a child exited
   before it was called.
 - A child that neither was forked by `forkUtility` nor attached is rejected: `invoke` rejects, and
   `send`, `handle`, `on`, `once` and `connect` (of the [channels of a page](utility-from-renderer.md)) throw
   an `IpcUtilityError` with `IPC_UTILITY_NOT_ATTACHED`, instead of a call that waits for a child that
   may be gone. Once a child has exited, `invoke` rejects with `IPC_UTILITY_EXITED`, `send` throws it,
   and so does `connect`.
 - The errors of `invoke` use the envelope also with `rawErrors`, since there is no Electron behavior
   to leave them to. `callUtility` and `callMain` take `timeoutMs` (see [Timeouts](../channels/invoke.md#timeouts)), and
   the default of the config applies to them; a call without a limit, whose handler never answers,
   waits until the process exits. There are no `allowedOrigins` or `validate` options, and
   `notifyUtility` and `notifyMain` have no options at all: both ends are your own code.
 - `utility.ts` fails with a `TypeError` when a channel is used outside a utility process. Importing it
   elsewhere is harmless.
 - The signature is checked for what structured clone cannot send, like the others. A call or a
   result that cannot be cloned at run time is rejected with `IPC_UTILITY_UNSENDABLE`.
 - With a [serializer](../schema/custom-serializers.md), the arguments, the results and the messages
   of these channels go through it. A call or a send that cannot be serialized fails with an
   `IpcSerializationError`, and a `send` that cannot be read is logged with `console.error` and
   dropped.

