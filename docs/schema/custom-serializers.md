# Custom serializers

Electron clones the arguments and results with the structured clone algorithm. A `Map`, a `Set`, a `Date` and a
`bigint` survive it, but a class instance loses its prototype, and a value such as a `URL` or an `undefined` member of
a union gets lost or changed. A custom serializer turns such values into something that survives, and back.

## Configuring a serializer

The `serializer` option of the config names a module:

```json
{ "config": { "autoipc": { "serializer": "superjson" } } }
```

The value is either a package name, such as `superjson` or `@scope/package`, or a path in the project which starts
with `./` or `../`. The generated files import a package name as it is, and a path from the project root becomes a
path relative to each generated file.

The module must export `serialize` and `deserialize` by these names:

```ts
// A path from the project root works as well: "serializer": "./src/wire.ts"
export function serialize(value: unknown): unknown { /* ... */ }
export function deserialize(wire: unknown): unknown { /* ... */ }
```

The shape is that of [superjson](https://github.com/flightcontrolhq/superjson): what `serialize` returns must be
cloneable by Electron (`{ json, meta }` is), and `deserialize` takes it back. Both are synchronous. The generated
`main.ts` and `preload.ts` import the module, so a sandboxed preload script needs a bundler that inlines it, as it does
for any import. The module is not part of the generated files, and the generated code has no dependency on this
library at runtime.

## What goes through the serializer

The arguments of a call travel as one value, the list of them. A serializer applies to these channels:

- **Page and main process:** the arguments and the result of `invoke`, the arguments of `send` and `emit`, the
  arguments and the answer of `ask`, and the arguments and the chunks of `stream`.
- **Port channels:** `port` and `mainPort`, at both ends, whether the other end is another page or the main process. A
  message is posted as a list of one value, the list of the arguments as the serializer made it. The main process only
  pairs the pages of a `port` channel and sees none of their messages, so its file does not import the serializer for
  that channel.
- **Utility processes**, at both ends, in `main.ts`, in `utility.ts` and in the preload script: the arguments and the
  result of `callUtility` and `callMain`, the arguments of `notifyUtility` and `notifyMain`, and, over the brokered
  port, the arguments and the result of `invokeUtility` and the arguments and the chunks of `streamUtility`. The main
  process only brokers the port between a page and a utility process and sees none of its messages, so its file does not
  import the serializer for `invokeUtility` and `streamUtility`.
- **Service workers**, in `main.ts` and in `service-worker-preload.ts`: the arguments and the result of
  `invokeFromWorker`, the arguments of `sendFromWorker` and `emitToWorker`, and the arguments and the answer of
  `askWorker`. The preload script of a worker is sandboxed, so it needs a bundler that inlines the serializer module,
  as the preload script of a page does.

The `data` of an error is not serialized: it is cloned as before.

## Behavior

### Order

The main process checks the sender first, then deserializes, then runs the `validate` schema on the deserialized
arguments. A message from a sender that is rejected never reaches the code of the serializer. This holds for a service
worker as well: `validateSender` and `allowedOrigins` come first.

### Failures

A value that cannot be serialized fails the call: an `invoke` or a `stream` rejects, and a `send` throws, in the page.

**In the page.** The rejection is the plain object `{ name: 'IpcSerializationError', message, code: 'IPC_SERIALIZATION' }`.
What a function throws synchronously reaches the page as an `Error` with the message only, since `contextBridge`
copies it that way, so a `send` throws an `Error` whose message begins with the code:
`[IPC_SERIALIZATION] The data cannot be serialized of the channel '...': ...`. The page tells the failure by that
prefix, and there is no `code` or `name` to read.

**In the main process.** The same failure throws an `IpcSerializationError` (exported from `main.ts`), also with the
code `IPC_SERIALIZATION`; for a call from the page it reaches the page in the error envelope. A message that cannot be
deserialized is answered with that error if someone waits for an answer, and otherwise (`send`, `emit`) it is logged
with `console.error` and dropped, so it is not an uncaught error of the main process. A chunk of a stream that cannot be
read fails the stream.

**On a port channel.** A `send` throws when its message cannot be serialized and a port is there. A message that waits
in the queue for a port is serialized when the queue is flushed, so one that cannot be is logged with `console.error`
and dropped, and the others go on. A message that arrives and cannot be deserialized is logged and dropped as well.

**With a utility process.** A call whose arguments cannot be serialized rejects, and a `send` throws, with an
`IpcSerializationError` in `main.ts` and in `utility.ts` (both export the class); in the page it is the plain object,
as above. A call that arrives with arguments that cannot be read, or whose result cannot be serialized, is answered
with the error envelope, so the caller rejects with an `IpcUtilityError` that has the `name` `IpcSerializationError`
and the `code` `IPC_SERIALIZATION`. A reply that cannot be deserialized rejects the call with an
`IpcSerializationError`. A `send` that arrives and cannot be read is logged with `console.error` and dropped, and a
`once` listener is not used up by it. A stream whose arguments cannot be read, or one of whose chunks cannot be
serialized in the child, fails with the error; a chunk that the page cannot deserialize fails the stream there and
cancels it in the child.

**With a service worker.** A call from the worker whose arguments cannot be serialized rejects, and a `send` throws, in
the worker, an `Error` whose message begins with the code, as above. A call that arrives with arguments that cannot be
read, or whose result cannot be serialized, is answered with the error envelope (or rejects with the
`IpcSerializationError`, with `rawErrors`). A message of the worker that cannot be read is logged with `console.error`
and dropped in the main process, and does not use up a `once` listener, and a message to the worker that cannot be read
is dropped there. Toward the worker, a question or a message that cannot be serialized rejects or throws an
`IpcSerializationError` in the main process, and nothing is sent. A question the worker cannot read is answered with the
error envelope, so the question rejects with an `IpcAskError` that carries the `name` and the `code` of the error; an
answer the main process cannot deserialize rejects it with the code `IPC_ASK_INVALID_REPLY`.

### The utility file

`utility.ts` imports the serializer module like `main.ts` does: a package name stays as it is, and a path from the
project root becomes a path relative to `utility.ts`. A utility process is a Node process with Node's module
resolution, not a sandbox, so a package resolves from the place of the file. Build `utility.ts` and the serializer
module for the child the way you build the rest of the child (the same bundler config as for `main.ts`), so that the
package or the TypeScript path is there when the process starts. The child and the main process must use the same
serializer module.

### `contextBridge`

The page and the preload script are separate worlds. The values that your serializer revives in the preload script
reach the page through `contextBridge`, which copies them again: a `Date`, a `Map` and a `Set` stay what they are, a
class instance becomes a plain object again. A serializer that revives classes helps the main process, and the page
only for the types that `contextBridge` carries.

### Both ends

All the code that talks to the channel must agree. A page that was built without the serializer cannot talk to a main
process that has it. Turn it on for the whole project.

### Types

The types in `types.ts` and in the signatures are those of the schema, as before: the signature says `Date`, and the
page gets a `Date`.
