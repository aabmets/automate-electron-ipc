# Verbs

A channel is declared with a verb: a helper that you import from `automate-electron-ipc`. The verb decides the kind
of the channel and its direction, and the type argument of the verb is the signature of the channel. This page lists
all verbs, the return types that each verb allows and the options that each verb accepts.

## Declaring channels

Each verb declares one kind of channel in one direction:

<!-- readme-example: verbs src/autoipc/schema.ts -->
```ts
import {
   defineChannels, invoke, send, emit, ask, stream, port, mainPort,
   callUtility, notifyUtility, callMain, notifyMain, invokeUtility, streamUtility,
   invokeFromWorker, sendFromWorker, askWorker, emitToWorker,
} from "automate-electron-ipc";

export interface User {
   id: number;
}
export interface Row {
   id: number;
}
export interface Token {
   value: string;
}

export default defineChannels({
   // Request from a renderer process to the main process with return data
   getUser: invoke<(id: number) => Promise<User>>(),

   // Message from a renderer process to the main process without return data
   echoUserName: send<(userName: string) => void>(),

   // Message from the main process to a renderer process without return data,
   // optionally with a generated binder which sends when a BrowserWindow event fires
   progress: emit<(n: number) => void>({ trigger: "focus" }),

   // Request from the main process to a renderer process with return data
   hasUnsavedChanges: ask<(documentId: number) => boolean>(),

   // Request from a renderer process to the main process with a stream of results, which the
   // renderer can cancel
   exportRows: stream<(table: string) => AsyncIterable<Row>>(),

   // Sender and listener on same port for each of two renderer processes
   chat: port<(msg: string) => void>(),

   // Sender and listener on one port between the main process and a renderer process
   logTail: mainPort<(line: string) => void>(),

   // Request from the main process to a utility process with return data
   indexFile: callUtility<(path: string) => Promise<number>>(),

   // Message from the main process to a utility process without return data
   setLogLevel: notifyUtility<(level: "debug" | "info") => void>(),

   // Request from a utility process to the main process with return data
   getSetting: callMain<(key: string) => Promise<string | undefined>>(),

   // Message from a utility process to the main process without return data
   indexed: notifyMain<(done: number, total: number) => void>(),

   // Request from a renderer process to a utility process with return data, over a brokered port
   queryRows: invokeUtility<(sql: string) => Promise<Row[]>>(),

   // Request from a renderer process to a utility process with a stream of results
   scanRows: streamUtility<(table: string) => AsyncIterable<Row>>(),

   // Request from a service worker to the main process with return data
   getToken: invokeFromWorker<(scope: string) => Promise<Token>>(),

   // Message from a service worker to the main process without return data
   syncDone: sendFromWorker<(pending: number) => void>(),

   // Request from the main process to a service worker with return data
   flushQueue: askWorker<(force: boolean) => number>(),

   // Message from the main process to a service worker without return data
   configChanged: emitToWorker<(key: string) => void>(),
});
```

## Directions and return types

| Verb     | Direction          | Return type of the signature |
|----------|--------------------|------------------------------|
| `invoke` | RendererToMain     | any value or promise         |
| `send`   | RendererToMain     | `void` or `Promise<void>`    |
| `emit`   | MainToRenderer     | `void` or `Promise<void>`    |
| `ask`    | MainToRenderer     | any value or promise         |
| `stream` | RendererToMain     | `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` |
| `port`   | RendererToRenderer | `void` or `Promise<void>`    |
| `mainPort` | MainToRenderer   | `void` or `Promise<void>`    |
| `callUtility` | MainToUtility | any value or promise         |
| `notifyUtility` | MainToUtility | `void` or `Promise<void>`  |
| `callMain` | UtilityToMain    | any value or promise         |
| `notifyMain` | UtilityToMain  | `void` or `Promise<void>`    |
| `invokeUtility` | RendererToUtility | any value or promise      |
| `streamUtility` | RendererToUtility | `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` |
| `invokeFromWorker` | ServiceWorkerToMain | any value or promise    |
| `sendFromWorker` | ServiceWorkerToMain | `void` or `Promise<void>`  |
| `askWorker` | MainToServiceWorker | any value or promise            |
| `emitToWorker` | MainToServiceWorker | `void` or `Promise<void>`    |

The verbs fall into four kinds, which decide what the return type may be:

- A **one-way** verb (`send`, `emit`, `notifyUtility`, `notifyMain`, `sendFromWorker`, `emitToWorker`) sends a message and
  gets no answer. Together with the **port** verbs (`port`, `mainPort`) it must return `void`, `Promise<void>`, or a union
  of those. Any other return type is an error.
- A **request** verb (`invoke`, `ask`, `callUtility`, `callMain`, `invokeUtility`, `invokeFromWorker`, `askWorker`) gets an
  answer, so its signature may return any value, or a promise of it.
- A **stream** verb (`stream`, `streamUtility`) must return an `AsyncIterable<Chunk>`, an `AsyncIterableIterator<Chunk>` or an
  `AsyncGenerator<Chunk>` of the global types. `Chunk` is the type of what the stream sends, one value at a time.
  A signature with another return type is an error.
- A signature never takes a `this` parameter, since IPC does not transfer `this`.

## Options

Each verb accepts these options in its config, an object literal that is the argument of the verb:

| Verb | Options |
|------|---------|
| `invoke` | `allowedOrigins`, `validate`, `timeoutMs`, `scopes` |
| `send` | `allowedOrigins`, `validate`, `scopes` |
| `emit` | `trigger`, `scopes` |
| `ask` | `scopes` |
| `stream` | `allowedOrigins`, `validate`, `highWaterMark`, `scopes` |
| `port`, `mainPort` | `maxQueue`, `scopes` |
| `callUtility`, `callMain` | `timeoutMs` |
| `invokeUtility` | `timeoutMs`, `scopes` |
| `streamUtility` | `timeoutMs`, `highWaterMark`, `scopes` |
| `invokeFromWorker` | `allowedOrigins`, `validate`, `timeoutMs` |
| `sendFromWorker` | `allowedOrigins`, `validate` |
| `notifyUtility`, `notifyMain`, `askWorker`, `emitToWorker` | none |

Each option is described with the kind of channel that has it, in the [channels](../channels/index.md) and
[processes](../processes/index.md) sections. A channel that is given an option its verb does not accept is an error
when the bindings are generated:

```text
option 'timeoutMs' is not supported by 'send'.
```

The values of the options are read from the source text, so they must be written as literals:

| Option | Value |
|--------|-------|
| `allowedOrigins`, `scopes` | an array of string literals |
| `trigger` | a string literal |
| `timeoutMs` | a non-negative integer literal |
| `maxQueue`, `highWaterMark` | a non-negative integer literal, or `Infinity` |
| `validate` | the name of a value that the schema file imports (a named or a default import) |

A variable, a computed value or a spread in a config is an error. `validate` cannot be a type-only import, a namespace
import or a declaration of the schema file itself, since the generated main bindings import it as a value from the module
that the schema file imports it from.

## Type arguments

A verb takes the signature as its first type argument. The verbs that can fail with a typed error (`invoke`, `stream`,
`invokeUtility`, `streamUtility` and `invokeFromWorker`) take the error types as an optional second one:

```ts
getUser: invoke<(id: number) => Promise<User>, NotFoundError | AuthError>(),
```

The error types are documented in the generated `types.ts` and in the typings of the renderer. See
[Errors](../channels/invoke.md#errors) for how a page receives them. The other verbs take exactly one type argument.
The signature can also be given after the call with [`as`](as-form.md), which cannot declare error types.
