# Processes

Not every channel runs between the main process and a renderer. This section covers the ones that connect a window to another window over a `MessagePort`, the main process to a utility process, a page to a utility process, and the main process to a service worker.

| Page | What it covers |
|------|----------------|
| [Port channels](ports.md) | `port` pairs two windows, `mainPort` pairs the main process with a window, both over a `MessagePort`. |
| [Bounded send queues](send-queues.md) | The `maxQueue` limit and the overflow callbacks of the port channels. |
| [Utility processes](utility-processes.md) | `callUtility`, `notifyUtility`, `callMain` and `notifyMain` between the main process and an Electron `utilityProcess`, and the generated `utility.ts`. |
| [Calling a utility process from a renderer](utility-from-renderer.md) | `invokeUtility` and `streamUtility`: a page talks to the child directly, and the main process only brokers the port. |
| [Service workers](service-workers.md) | `invokeFromWorker`, `sendFromWorker`, `askWorker` and `emitToWorker` between the main process and a service worker, and the generated `service-worker-preload.ts`. |

The channels of this section are declared in the schema like any other (see [Schema verbs](../schema/verbs.md)), and the generator writes the extra files that they need: `utility.ts` for the code of a utility process, and `service-worker-preload.ts` with `service-worker.d.ts` for a service worker.
