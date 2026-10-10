# The `as` form

The signature of a channel can also be written after the call with `as`. It is an alternative to the type argument,
and the two cannot be combined on one channel:

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

## What it loses

The type argument form lets TypeScript check the config against the signature, and it is the only form which can
declare error types. In the `as` form the config is not checked against the signature.

Writing the signature twice, as a type argument and with `as`, is an error:

```text
the signature is given twice, as a type argument and with 'as'. Use only one of them. Error types need the type argument form.
```
