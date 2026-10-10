# The `as` form

The signature of a channel is usually the type argument of the verb: `invoke<(id: number) => Promise<User>>()`. It
can also be written after the call with `as`. This page shows that form and what it gives up.

The `as` form is an alternative to the type argument, and the two cannot be combined on one channel. Every verb
accepts it, with or without a config object:

<!-- readme-example: as-form src/autoipc/schema.ts -->
```ts
import { defineChannels, emit, invoke } from "automate-electron-ipc";

export interface User {
   id: number;
}

export default defineChannels({
   getUser: invoke() as (id: number) => Promise<User>,
   progress: emit({ trigger: "focus" }) as (n: number) => void,
});
```

Both forms declare the same channel: the generated code, the helper types and the `window.ipc` typings are the
same. Use the one that reads better to you.

## What it loses

The type argument form lets TypeScript check the config against the signature, and it is the only form which can
declare error types. In the `as` form:

- The config is not checked against the signature. The `validate` option takes any Standard Schema, even one for
  other arguments than the signature has, where the type argument form wants a schema of the argument tuple.
- There is no second type argument, so a verb in the `as` form cannot declare error types (see
  [Errors](../channels/invoke.md#errors)).

## Combining the two forms

Writing the signature twice, as a type argument and with `as`, is an error:

```text
the signature is given twice, as a type argument and with 'as'. Use only one of them. Error types need the type argument form.
```

The message starts with the file, the position and the channel, like the other
[schema errors](../getting-started/channel-maps.md#reading-schema-errors). A verb with neither form is an error too,
see [Verbs](verbs.md#errors).
