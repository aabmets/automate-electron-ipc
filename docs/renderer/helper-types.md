# Helper types

`ipcgen` writes `types.ts` to the data directory, next to the other generated files. It holds the types of the API of the page, so that code which wraps the API generically (a helper, a hook, a test utility) can name them. This page lists what the file exports and how to use the helper types.

`types.ts` declares no global variable, so any file can import it, a file of the main process included. The global `window.ipc` itself is declared by `window.d.ts`, which takes its types from this file.

## What the file exports

| Type | Is |
|------|----|
| `IpcApi` | The interface of the API of the page: what `window.ipc` is, with one member per channel of the page |
| `ChannelName` | The union of the names of the channels of the page |
| `ChannelArgs<N>` | The parameters of the channel `N`, as a tuple |
| `ChannelReturn<N>` | What a call of the channel `N` gives: the result of the handler with its promise resolved, and the type of one chunk for a `stream` |

`ChannelArgs` and `ChannelReturn` read the signature that you wrote in the schema, whatever the kind of the channel: for an `emit` channel the arguments are those of the listener, and for an `ask` channel those of the responder.

```typescript
import type { ChannelArgs, ChannelName, ChannelReturn } from "./autoipc/types";

// A typed wrapper for any `invoke` channel of the page.
async function call<N extends ChannelName>(name: N, ...args: ChannelArgs<N>): Promise<ChannelReturn<N>> {
   const channel = window.ipc[name] as unknown as { invoke(...args: unknown[]): Promise<ChannelReturn<N>> };
   return channel.invoke(...args);
}

const user = await call("getUser", 1);   // typed as what the handler of getUser returns
```

A name that is not a channel of the page is a type error. For a schema without channels, `ChannelName` is `never`.

## The members of `IpcApi`

Each member of `IpcApi` has the methods that the page calls for that kind of channel:

| Channel | Methods of `IpcApi[name]` |
|---------|---------------------------|
| `invoke`, `invokeUtility` | `invoke` |
| `send` | `send` |
| `emit` | `on`, `once` |
| `ask` | `handle` |
| `stream`, `streamUtility` | `stream` |
| `port`, `mainPort` | `send`, `on`, `onReady`, `onClose`, `onOverflow`, `onConnection` |

With the config option `getPathForFile`, `IpcApi` also has `getPathForFile(file: File): string`. See [The generated API](../schema/generated-api.md) for how each method behaves.

## Error and stream types

`types.ts` also exports the types that the members refer to. Each one is declared only when a channel of the page uses it:

| Type | Is |
|------|----|
| `IpcError<E>` | The plain object that a rejected `invoke` or a failed `stream` read gives: `name` and `message`, plus `code` and `data` as the error class `E` has them |
| `IpcTimeoutError` | The error of an `invoke` that ran into its `timeoutMs`, with the code `IPC_TIMEOUT` |
| `IpcUtilityError` | The error that the library gives for a call to a utility process, apart from the errors of the handler |
| `IpcStream<T>` | What `stream` returns: `next()`, `return()`, `cancel()` and `Symbol.asyncIterator` |
| `IpcPortOverflowInfo`, `IpcPortOverflowAction` | The types of the callback of `onOverflow` on a port channel |

The global types `IpcError`, `IpcTimeoutError` and `IpcUtilityError` that `window.d.ts` declares are the ones from this file.

## What the helper types cover

`ChannelArgs` and `ChannelReturn` look the signature up in the exported channel map of each schema file with `typeof`, so `types.ts` imports the schema files (as types only) and the type `ChannelDef` of this library. They work for both forms of the declaration: the verb call `invoke<(id: number) => Promise<User>>()` and the [`as` form](../schema/as-form.md).

- They cover the channels that a page has, `invokeUtility` and `streamUtility` included. The channels between the main process and a utility process or a service worker are not part of the API of a page, so they are not in `ChannelName`.
- With [scopes](../security/scopes.md), `types.<scope>.ts` holds the channels of that scope, in addition to the ones without `scopes`. `types.ts` itself has only the channels without `scopes`.
- `types.ts` is written on every run, also for a schema without channels. Its path follows `ipcDataDir`; no other config option moves it.
