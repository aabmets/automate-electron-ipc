# Processes

Most channels run between the main process and a page. This section covers the channels that connect other parties: a window to another window, the main process to a window over a `MessagePort`, the main process to a utility process, a page to a utility process, and the main process to a service worker.

| Page | What it covers |
|------|----------------|
| [Port channels](ports.md) | `port` pairs two windows, `mainPort` pairs the main process with a window, both over a `MessagePort`. |
| [Bounded send queues](send-queues.md) | The `maxQueue` limit of the port channels, and the overflow callbacks that decide which messages are dropped. |
| [Utility processes](utility-processes.md) | `callUtility`, `notifyUtility`, `callMain` and `notifyMain` between the main process and an Electron `utilityProcess`, and the generated `utility.ts`. |
| [Calling a utility process from a renderer](utility-from-renderer.md) | `invokeUtility` and `streamUtility`: a page talks to the child directly, and the main process only brokers the port. |
| [Service workers](service-workers.md) | `invokeFromWorker`, `sendFromWorker`, `askWorker` and `emitToWorker` between the main process and a service worker, and the generated `service-worker-preload.ts`. |

The channels are declared in the schema like any other (see [Schema verbs](../schema/verbs.md)). The generator writes the extra files that they need, and only when the schema has a channel that uses them:

| File | Written for | Path option |
|------|-------------|-------------|
| `utility.ts` | the code that runs in a utility process | `utilityBindingsPath` |
| `service-worker-preload.ts` | the preload script of a service worker | `serviceWorkerPreloadPath` |
| `service-worker.d.ts` | the typings of the worker code, next to its preload script | none, it follows `serviceWorkerPreloadPath` |

The path options are described in [Configuration](../tooling/configuration.md), and the files in [Generated files](../tooling/generated-files.md). The main process always gets its API from `main.ts`, and a page from the preload script, as for the other channels.
