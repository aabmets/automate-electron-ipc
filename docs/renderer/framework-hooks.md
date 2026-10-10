# Framework hooks

`ipcgen` can write a small file of hooks (React) or composables (Vue) for the channels of the page: one function to listen to an `emit` channel, and one to call an `invoke` channel and keep the state of the call. This page shows how to turn them on and what they do.

Set the config option `hooks` to `"react"` or `"vue"`, here in `package.json` (a config file works too, see [Configuration](../tooling/configuration.md)):

```json
{
   "config": {
      "autoipc": {
         "hooks": "react"
      }
   }
}
```

The library itself depends on neither framework. The generated file imports `react` or `vue`, which your project has.

## What both files share

- Only one of the two files is written, to the data directory next to `types.ts`: `hooks.react.ts` or `hooks.vue.ts`. When you set `hooks` back to `false` or change the framework, the next run removes the file of the earlier run, like the other [generated files](../tooling/generated-files.md#stale-files). A file without the generated header is never removed.
- They have the same two functions, `useIpcEvent` and `useIpcInvoke`, with the same types.
- They are for the channels that have no [scope](../security/scopes.md), and take their types from `types.ts` (see [Helper types](helper-types.md)).
- They reach the API through `globalThis[exposeAs]`, so the API must be exposed in the main world under that name. That is the default; the hooks do not work with `isolatedWorldId`, or with an `autoExpose` setup that exposes the API under another key.
- They export the types `EventName`, `EventCallback<N>`, `InvokeName`, `InvokeArgs<N>` and `InvokeReturn<N>`, which are picked out of `IpcApi`. `EventName` is the names of the `emit` channels, and `InvokeName` the names of the channels with an `invoke` method, which includes `invokeUtility` channels. A name of another kind, such as an `invoke` channel in `useIpcEvent`, is a type error.
- The other channel kinds (`send`, `ask`, `stream` and the ports) have no hook; use the API directly.

## React

With `"hooks": "react"`, `ipcgen` writes `hooks.react.ts`.

```typescript
import { useIpcEvent, useIpcInvoke } from "./autoipc/hooks.react";

function Profile({ id }: { id: number }) {
   // `titleChanged` is an `emit` channel: the callback is typed as its signature.
   useIpcEvent("titleChanged", (title) => {
      document.title = title;
   });

   // `getUser` is an `invoke` channel.
   const { invoke, data, error, pending } = useIpcInvoke("getUser");

   return (
      <button type="button" disabled={pending} onClick={() => invoke(id).catch(() => undefined)}>
         {error ? "Failed" : (data?.name ?? "Load")}
      </button>
   );
}
```

| Hook | Does |
|------|------|
| `useIpcEvent(name, callback)` | Subscribes to an `emit` channel when the component mounts, and unsubscribes when it unmounts or `name` changes. It calls the latest `callback`, so a new function on each render does not resubscribe |
| `useIpcInvoke(name)` | Returns `invoke(...args)` for an `invoke` channel, with the state of the latest call: `data` (the last result), `error` (the error of the last call, as `unknown`) and `pending` (`boolean`). `invoke` keeps its identity until `name` changes |

`invoke` resolves with the result and rejects with the error, as the call of the channel does, and also sets `data` or `error`. So a call that nobody catches, such as `onClick={() => invoke(id)}`, ends in an unhandled rejection. Catch it, as the example does, and read `error` for the message to show.

The state follows these rules:

- `error` is cleared when a new call starts.
- When a call fails, `data` keeps the last result.
- The result of a call that finishes after the component unmounted, or after a newer call started, does not change the state.

## Vue

With `"hooks": "vue"`, `ipcgen` writes `hooks.vue.ts` instead, with composables of the same names and the same types.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useIpcEvent, useIpcInvoke } from "./autoipc/hooks.vue";

const title = ref("");
useIpcEvent("titleChanged", (next) => {
   title.value = next;
});

const { invoke, data, error, pending } = useIpcInvoke("getUser");
</script>

<template>
   <button type="button" :disabled="pending" @click="invoke(1).catch(() => undefined)">
      {{ error ? "Failed" : (data?.name ?? "Load") }}
   </button>
</template>
```

| Composable | Does |
|------------|------|
| `useIpcEvent(name, callback)` | Subscribes to an `emit` channel at once, and unsubscribes when the active effect scope is disposed, which is when the component unmounts if it is called in `setup`. The `callback` that you pass is the one that is called |
| `useIpcInvoke(name)` | Returns `invoke(...args)` for an `invoke` channel, with the state of the latest call as refs: `data` (a `ShallowRef` with the last result), `error` (a `ShallowRef` with the error of the last call) and `pending` (a `Ref<boolean>`) |

`invoke` resolves with the result and rejects with the error, and the state follows the same rules as in the React hooks: `error` is cleared when a new call starts, `data` keeps the last result when a call fails, and the result of a call that finishes after the scope was disposed, or after a newer call started, does not change the refs.

Call both composables in `setup`, or inside an effect scope: outside of one, `useIpcEvent` never unsubscribes, and Vue warns about it.
