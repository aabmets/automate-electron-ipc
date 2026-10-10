# Mocking in renderer tests

`ipcgen` can write `mock.ts`, a fake of `window.ipc`. With it, the code of your page runs in a unit test, in Storybook or in a plain browser, where there is no Electron and no preload script. This page shows how to turn the mock on, use it in a test, and what each kind of channel does in it.

Set the config option `mock` to `true`. `ipcgen` then writes `mock.ts` to the data directory (`ipcDataDir`), next to `types.ts`. The path cannot be changed.

The mock imports `IpcApi` from `types.ts` (see [Helper types](helper-types.md)) and nothing else: there is no mocking library and no dependency on this library, and the stubs are written out in the file. It is typed by the schema, so a call with the wrong arguments does not compile.

## Using the mock in a test

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

In a test runner, make one mock per test and uninstall it afterwards, so that no state leaks from one test into the next:

```typescript
import { afterEach, beforeEach } from "vitest";
import { createIpcMock, installIpcMock, type IpcMock } from "./autoipc/mock";

let mock: IpcMock;
let uninstall: () => void;

beforeEach(() => {
   mock = createIpcMock();
   uninstall = installIpcMock(mock);
});

afterEach(() => uninstall());
```

## What each channel becomes

`mock` has a member for each channel of the page. The calls are stubs; the other members are those of the API.

| Channel | The mock |
|---------|----------|
| `invoke`, and a call to a utility process | `mock.<name>.invoke` is a `Stub`; it resolves `undefined` until a test gives it an implementation |
| `send` | `mock.<name>.send` is a `Stub`; it returns `undefined` |
| `stream`, and a stream from a utility process | `mock.<name>.stream` is a `Stub` that returns a stream without chunks, which has `next`, `return`, `cancel` and `Symbol.asyncIterator` |
| `emit` | `on` and `once` keep their listeners, and return a function that removes that one. `mock.emit.<name>(...args)` calls them |
| `ask` | `handle(callback)` keeps the one responder, and a new one replaces it (the function it returns removes only its own). `mock.ask.<name>(...args)` calls it and returns a promise of its answer |
| `port`, `mainPort` | not mocked: every method throws `Error("ports are not mocked")` |

`getPathForFile`, when the config adds it, is a `Stub` that returns an empty string.

`mock.emit` and `mock.ask` stand in for the main process. They exist even when the schema has no `emit` or no `ask` channel, and are then empty. For that reason a channel cannot be named `emit` or `ask` while `mock` is on: `ipcgen` stops with `Channel name 'emit' is reserved, since the config 'mock' adds a member of that name to the API. Rename the channel, or turn the config off.`

A question to a page that has registered no responder is rejected with an error whose `name` is `IpcAskError` and whose `code` is `IPC_ASK_NO_HANDLER`, as the real preload script answers the main process.

The listeners of `emit` channels follow the preload script: they run in the order of subscription, a `once` listener is removed before it runs, a listener that throws is logged with `console.error` and does not stop the others, and a listener that was removed during a dispatch is not called by it.

## Stubs

A `Stub<F>` is a function of the type of the call, with these members:

- `calls`: the arguments of every call, in order.
- `impl(fn)`: replaces the implementation, until `reset()`.
- `reset()`: clears the calls and removes the replacement, so that the default behavior of the table above applies again. That includes an implementation that you gave to `createIpcMock`.

## Creating and installing the mock

`createIpcMock(overrides)` makes the mock. `overrides` is any part of the API, as the API has it: the function of a call becomes its first implementation, and any other member (a port method, say) is replaced. A member that the API does not have is an error: `The mock has no member 'name'`. Each mock has its own listeners, responders and stubs, so make one per test.

`installIpcMock(mock, target)` installs the mock under the `exposeAs` name of the config (`ipc` by default) on the target that you give. `target` is `globalThis` by default, and `mock` defaults to a fresh `createIpcMock()`. The function it returns restores what the target had before, once; calling it again does nothing.

`mock.ts` also exports the types `IpcMock`, `Stub` and `DeepPartial`.

## Limits

- The mock covers the channels of the page that have no [scope](../security/scopes.md); the channels of a scope are not mocked, and no `mock.<scope>.ts` is written.
- The channels between the main process and a utility process or a service worker are not part of the API of the page, so they are not mocked either.
- `mock.ts` is removed as a [stale file](../tooling/generated-files.md#stale-files) when `mock` is turned off again, unless it has no generated header.
- A schema without channels of the page still gets a `mock.ts`, with no members apart from `emit` and `ask`.
