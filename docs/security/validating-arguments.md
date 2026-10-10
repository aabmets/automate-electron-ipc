# Validating arguments

Renderer input is untrusted, and TypeScript types are erased at runtime. This page shows how to have the main process check the arguments of a call against a schema before your handler sees them.

## The validate option

To check the arguments of an `invoke`, `send` or `stream` channel, give it `validate`: a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, ...) of the argument tuple. A signature stays required, and `validate` is checked against its parameters: the output of the schema must be the tuple `Parameters<S>` of the signature. (The `as` form does not check the config against the signature, so any Standard Schema is accepted there.)

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

The value of `validate` must be an identifier that the schema file imports as a value, as a named or default import. `ipcgen` stops with one of these messages otherwise:

| Mistake | Message of `ipcgen` |
|:--|:--|
| Not an identifier, such as a call or a member | `option 'validate' must be an identifier which the schema file imports.` |
| A name that the file declares itself or does not import | `option 'validate' refers to '<name>', which is not imported in the schema file. Import the schema from another module.` |
| A type-only import | `option 'validate' refers to '<name>', which is a type-only import. Import it as a value.` |
| A namespace import | ``option 'validate' refers to '<name>', a namespace import. Import the schema itself, such as `import { schema } from '...'`.`` |

The generated `main.ts` imports the validator from the same module, so it does not depend on any validation library.

## What the generated code does

The generated `main.ts` runs the schema on the arguments of the call, as one array, after the sender check and before your handler. The handler receives the output of the schema, so a transforming schema (a default, a coercion, stripped keys) is honored. With a [serializer](../schema/custom-serializers.md), the schema sees the arguments after they are deserialized.

A call fails when the schema reports issues. It also fails, with a generic message, when the schema throws, rejects, or answers with anything but an array of arguments. The message of an error that your schema throws is not passed on. A synchronous schema keeps the call synchronous, and an asynchronous one is awaited.

What the caller sees, for an invalid call:

| Channel | Result |
|:--|:--|
| `invoke` | The handler does not run. The promise in the page is rejected with `{ name: "IpcValidationError", message, code: "IPC_VALIDATION", data }`, where `data` is the list of issues, each with a `message` and a `path` (see [Errors](../channels/invoke.md#errors)) |
| `stream` | The same rejection, as the first read of the stream |
| `send` | The message is dropped |

The `message` is `The arguments of the channel '<name>' are invalid: ` followed by the messages of the issues, joined with `; `. In the main process, `IpcValidationError` is an `Error` with the fields `code` (`"IPC_VALIDATION"`), `channel`, `issues` (as the schema gave them) and `data` (the issues with plain paths, which can be sent to the page). `main.ts` exports it when a channel uses `validate`. With `rawErrors`, an `invoke` is rejected with the text that Electron makes of the error instead.

`onRejected` of [`configureIpc`](sender-validation.md#configureipc-and-validatesender) is called for every invalid call and receives the error as its third argument, an `IpcValidationError` or an `IpcForbiddenError`. A hook that throws does not change the outcome. `once` and `handleOnce` are not used up by an invalid call.

## Service workers

The channels that a service worker calls in the main process accept `validate` too. A failed worker call is reported to the `onRejected` hook of `configureServiceWorkerIpc`, not to the one of `configureIpc`. A worker's `invokeFromWorker` call is rejected with an `IpcValidationError`, and a `sendFromWorker` message is dropped. See [Service workers](../processes/service-workers.md).

## Validation is not authorization

A schema vouches for the shape of the arguments. Whether the page may ask for what they name is for the handler to decide, as [the example](putting-it-together.md) shows.
