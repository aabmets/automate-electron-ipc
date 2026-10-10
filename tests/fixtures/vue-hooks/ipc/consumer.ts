// Not a schema: a setup function that uses the generated composables. The test compiles it with the
// hooks file, so every `@ts-expect-error` below must be a real error, or the check fails.
import type { Ref, ShallowRef } from "vue";
import { useIpcEvent, useIpcInvoke } from "./hooks.vue";
import type { User } from "./schema/main";

export function Profile(id: number) {
   useIpcEvent("titleChanged", (title) => {
      const upper: string = title.toUpperCase();
      document.title = upper;
   });
   useIpcEvent("moved", (x, y) => {
      const sum: number = x + y;
      return sum;
   });
   const user = useIpcInvoke("getUser");
   const sum = useIpcInvoke("sum");
   const ping = useIpcInvoke("ping");
   const loaded: ShallowRef<User | undefined> = user.data;
   const failure: ShallowRef<unknown> = user.error;
   const pending: Ref<boolean> = user.pending;
   const name: string | undefined = loaded.value?.name;
   user.invoke(id).then((found: User) => found.id);
   sum.invoke(1, 2).then((total: number) => total);
   ping.invoke();
   return { name, failure, pending };
}

export function WrongNames() {
   // @ts-expect-error a name that is not a channel
   useIpcEvent("missing", () => undefined);
   // @ts-expect-error an invoke channel is not an event
   useIpcEvent("getUser", () => undefined);
   // @ts-expect-error a send channel is not an event
   useIpcEvent("logLine", () => undefined);
   // @ts-expect-error a port channel is not an event
   useIpcEvent("chat", () => undefined);
   // @ts-expect-error the title is a string
   useIpcEvent("titleChanged", (title: number) => title);
   // @ts-expect-error a name that is not a channel
   useIpcInvoke("missing");
   // @ts-expect-error an emit channel is not an invoke
   useIpcInvoke("titleChanged");
   // @ts-expect-error a stream channel is not an invoke
   useIpcInvoke("rows");
   // @ts-expect-error an ask channel is not an invoke
   useIpcInvoke("hasUnsaved");
}

export function WrongArguments() {
   const user = useIpcInvoke("getUser");
   // @ts-expect-error the argument is a number
   user.invoke("1");
   // @ts-expect-error the argument is missing
   user.invoke();
   // @ts-expect-error `getUser` resolves to a user, not a string
   const name: string = user.data.value;
   // @ts-expect-error `pending` is a ref, not a boolean
   const pending: boolean = user.pending;
   return { name, pending };
}
