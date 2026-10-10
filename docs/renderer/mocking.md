# Mocking in renderer tests

With the config option `mock` set to `true`, `ipcgen` writes `mock.ts` (in the data directory) for the surface of no [scope](../security/scopes.md). It is a fake of `window.ipc` for unit tests of the renderer, Storybook and a UI that runs in a plain browser, where there is no Electron and no preload script.

It imports `IpcApi` from `types.ts` (see [Helper types](helper-types.md)) and nothing else: there is no mocking library and no dependency on this library, and the stubs are written out in the file. It is typed by the schema, so a call with the wrong arguments does not compile.

```typescript
import { createIpcMock, installIpcMock } from "./autoipc/mock";

const mock = createIpcMock({
   getUser: { invoke: async (id) => ({ id, name: "Ann" }) },   // the implementation of one call
});
const uninstall = installIpcMock(mock);   // sets mock as `ipc` of globalThis; installIpcMock(mock, window) for a window

renderUserCard(1);                          // the code under test calls window.ipc.getUser.invoke(1)
expect(mock.getUser.invoke.calls).toStrictEqual([[1]]);

mock.getUser.invoke.impl(async () => { throw new Error("offline"); });   // another implementation, from now on
mock.getUser.invoke.reset();                // clears the calls and puts the default back
mock.emit.titleChanged("Home");             // the main process emits: calls the listeners of the page
await mock.ask.hasUnsaved(3);               // the main process asks: calls the responder of the page

uninstall();                                // puts back what `ipc` was before
```

## What each channel becomes

| Channel | The mock |
|---------|----------|
| `invoke`, and a call to a utility process | `mock.<name>.invoke` is a `Stub`; it resolves `undefined` until a test gives it an implementation |
| `send` | `mock.<name>.send` is a `Stub`; it returns `undefined` |
| `stream`, and a stream from a utility process | `mock.<name>.stream` is a `Stub` that returns a stream without chunks, which has `next`, `return`, `cancel` and `Symbol.asyncIterator` |
| `emit` | `on` and `once` keep their listeners, and return a function that removes that one. `mock.emit.<name>(...args)` calls them |
| `ask` | `handle(callback)` keeps the one responder, and a new one replaces it (the function it returns removes only its own). `mock.ask.<name>(...args)` calls it and returns a promise of its answer, which is rejected with the code `IPC_ASK_NO_HANDLER` if the page has registered none |
| `port` | not mocked: every method throws `Error("ports are not mocked")` |

## Stubs

A `Stub<F>` is a function of the type of the call, with these members:

- `calls`: the arguments of every call, in order.
- `impl(fn)`: replaces the implementation.
- `reset()`: clears the calls and the implementation.

`getPathForFile`, when the config adds it, is a `Stub` that returns an empty path.

The listeners of `emit` channels follow the preload script: they run in the order of subscription, a `once` listener is removed before it runs, and a listener that throws is logged with `console.error` and does not stop the others.

## Creating and installing the mock

`createIpcMock(overrides)` takes any part of the API: the function of a call becomes its first implementation, and any other member (a port method, say) is replaced. A member that the API does not have is an error. Each mock has its own listeners, responders and stubs, so make one per test.

`installIpcMock(mock, target)` installs the mock under the `exposeAs` name of the config on the target that you give (`globalThis` by default; `mock` defaults to a fresh `createIpcMock()`). The function it returns restores the previous value of the target, once.

## Limits

- The mock covers the channels of the page that have no scope; the channels of a scope are not mocked.
- The channels between the main process and a utility process or a service worker are not part of the API of the page, so they are not mocked either.
- `mock.ts` is not moved by a config option, and is removed as a [stale file](../tooling/generated-files.md) when `mock` is turned off again.
