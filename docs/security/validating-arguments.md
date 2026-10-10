# Validating arguments

Renderer input is untrusted, and TypeScript types are erased at runtime. This page shows how to have the main process check the arguments of a call before your handler sees them.

## The validate option

To check the arguments of an `invoke`, `send` or `stream` channel, give it `validate`: a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, ...) of the argument tuple. It must be an identifier which the schema file imports as a value. A signature stays required, and `validate` is checked against its parameters.

```typescript
import { z } from "zod";
export const getUserArgs = z.tuple([z.number().int().positive()]);
```

```typescript
import { getUserArgs } from "./validators";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>({ validate: getUserArgs }),
});
```

## What the generated code does

The generated `main.ts` imports `getUserArgs` and runs it on the arguments as they arrived, after the sender check and before your handler. The handler receives the output of the schema, so a transforming schema (a default, a coercion, stripped keys) is honored.

An invalid `invoke` throws an `IpcValidationError` with the `issues` of the schema, which the renderer sees as a rejected promise with the code `IPC_VALIDATION` and the issues as `data` (see [Errors](../channels/invoke.md#errors)). An invalid `send` is dropped. `onRejected` of [`configureIpc`](sender-validation.md#configureipc-and-validatesender) is called for both and receives the error as its third argument, an `IpcValidationError` or an `IpcForbiddenError`.

A schema which throws, rejects, or answers with anything but an array of arguments counts as a failure, and the message of such an error is not passed on. A synchronous schema keeps the call synchronous, an asynchronous one is awaited. `once` and `handleOnce` are not used up by an invalid call. The generated code does not depend on any validation library: it uses the Standard Schema interface through a structural type.

## Service workers

The channels that a service worker calls in the main process accept `validate` too. A failed worker call is reported to the `onRejected` hook of `configureServiceWorkerIpc`, not to the one of `configureIpc`. See [Service workers](../processes/service-workers.md).

## Validation is not authorization

A schema vouches for the shape of the arguments. Whether the page may ask for what they name is for the handler to decide, as [the example](putting-it-together.md) shows.
