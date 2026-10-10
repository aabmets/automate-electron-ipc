# Helper types

`ipcgen` writes `types.ts` next to the other generated files. It declares no global, so any file can import it, also one of the main process, and it holds the types for code that wraps the API generically.

| Type | Is |
|------|----|
| `IpcApi` | The interface of the API of the page: what `window.ipc` is, with the members of every channel of the page |
| `ChannelName` | The union of the names of the channels of the page |
| `ChannelArgs<N>` | The parameters of the channel `N`, as a tuple |
| `ChannelReturn<N>` | What a call of the channel `N` gives: the result of the handler with its promise resolved, and the type of the chunks for a `stream` |

```typescript
import type { ChannelArgs, ChannelName, ChannelReturn } from "./autoipc/types";

// A typed wrapper for any `invoke` channel of the page.
async function call<N extends ChannelName>(name: N, ...args: ChannelArgs<N>): Promise<ChannelReturn<N>> {
   const channel = window.ipc[name] as unknown as { invoke(...args: unknown[]): Promise<ChannelReturn<N>> };
   return channel.invoke(...args);
}

const user = await call("getUser", 1);   // typed as what the handler of getUser returns
```

## Error and stream types

The error types that the members refer to (`IpcError<E>`, `IpcTimeoutError` and `IpcUtilityError`, when a channel can fail with them), `IpcStream<T>` and the types of the overflow callbacks are exported from the same file. The global types `IpcError` and the like that `window.d.ts` declares are those of this file.

## What the helper types cover

`ChannelArgs` and `ChannelReturn` read the signature from the exported channel map of the schema file, with `typeof`, so `types.ts` imports the schema file (as a type only) and the type `ChannelDef` of this library. They hold for both forms of the declaration, the verb call `invoke<(id: number) => Promise<User>>()` and the [`as` form](../schema/as-form.md).

- They cover the channels that the page has, not the ones to a utility process or a service worker that the page has no part in.
- With [scopes](../security/scopes.md), `types.<scope>.ts` holds the channels of that scope.
- `types.ts` is written on every run, also for a schema without channels, where `ChannelName` is `never`.
