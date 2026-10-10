# Framework hooks

With the config option `hooks` set to `"react"` or `"vue"`, `ipcgen` writes a file of hooks (or composables) for the events and the `invoke` channels of the page. The library itself depends on neither framework: the generated file imports `react` or `vue`, which your project has.

Both files share these properties:

- They are for the surface of no [scope](../security/scopes.md), and take their types from `types.ts` (see [Helper types](helper-types.md)).
- They reach the API through `globalThis[exposeAs]`, so the API must be exposed in the main world, which is the default.
- They are written, and removed again when you set `hooks` back to `false` or change the framework, like the other [generated files](../tooling/generated-files.md). Only one of the two files is written; changing `hooks` removes the file of the earlier run, if it has the generated header.
- They have the same two functions, `useIpcEvent` and `useIpcInvoke`, with the same types.

## React

With `"hooks": "react"`, `ipcgen` writes `hooks.react.ts` next to `types.ts`.

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
| `useIpcInvoke(name)` | Returns `invoke(...args)` for an `invoke` channel, with the state of the latest call: `data` (the last result), `error` (the error of the last call, cleared when a new call starts) and `pending` |

`invoke` resolves with the result and rejects with the error, as the call of the channel does, and also sets `data` or `error`. So a call that nobody catches, such as `onClick={() => invoke(id)}`, ends in an unhandled rejection. Catch it, as the example does, and read `error` for the message to show.

The result of a call that finishes after the component unmounted, or after a newer call started, does not change the state. When a call fails, `data` keeps the last result.

`hooks.react.ts` also exports the types `EventName`, `EventCallback<N>`, `InvokeName`, `InvokeArgs<N>` and `InvokeReturn<N>`, which are picked out of `IpcApi`. A name that is not a channel of that kind, such as an `invoke` channel in `useIpcEvent`, is a type error.

The other channel kinds (`send`, `ask`, `stream` and the ports) have no hook; use the API directly.

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
| `useIpcEvent(name, callback)` | Subscribes to an `emit` channel at once, and unsubscribes when the active effect scope is disposed, which is when the component unmounts if it is called in `setup` |
| `useIpcInvoke(name)` | Returns `invoke(...args)` for an `invoke` channel, with the state of the latest call as refs: `data` (a `ShallowRef` with the last result), `error` (a `ShallowRef` with the error of the last call, cleared when a new call starts) and `pending` (a `Ref<boolean>`) |

`invoke` resolves with the result and rejects with the error, and the result of a call that finishes after the scope was disposed, or after a newer call started, does not change the refs; this is the same as in the React hooks.

Call both composables in `setup`, or inside an effect scope: outside of one, `useIpcEvent` never unsubscribes, and Vue warns about it.
