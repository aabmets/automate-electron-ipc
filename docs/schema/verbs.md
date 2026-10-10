# Verbs

A channel is declared with a verb: a helper that you import from `automate-electron-ipc`. The verb decides who
sends and who answers, the type argument of the verb is the signature of the channel, and an optional object
of options tunes it. This page lists all 17 verbs, what their signatures may return and the options that each
one takes.

## Declaring channels

Each verb declares one kind of channel in one direction. The comments in this schema say what each one is for:

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

A declaration is made of these parts. The verb and the signature are required, the error types and the options
are optional:

```ts
getUser: invoke<(id: number) => Promise<User>, NotFoundError>({ timeoutMs: 5000 }),
//       ^verb  ^signature                      ^error types    ^options
```

## Directions and return types

| Verb | From | To | Return type of the signature | Described in |
|------|------|----|------------------------------|--------------|
| `invoke` | page | main process | any value or promise | [invoke](../channels/invoke.md) |
| `send` | page | main process | `void` or `Promise<void>` | [send](../channels/send.md) |
| `emit` | main process | page | `void` or `Promise<void>` | [emit](../channels/emit.md) |
| `ask` | main process | page | any value or promise | [ask](../channels/ask.md) |
| `stream` | page | main process | `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` | [stream](../channels/stream.md) |
| `port` | page | another page | `void` or `Promise<void>` | [Port channels](../processes/ports.md) |
| `mainPort` | main process | page, both ways | `void` or `Promise<void>` | [Port channels](../processes/ports.md) |
| `callUtility` | main process | utility process | any value or promise | [Utility processes](../processes/utility-processes.md) |
| `notifyUtility` | main process | utility process | `void` or `Promise<void>` | [Utility processes](../processes/utility-processes.md) |
| `callMain` | utility process | main process | any value or promise | [Utility processes](../processes/utility-processes.md) |
| `notifyMain` | utility process | main process | `void` or `Promise<void>` | [Utility processes](../processes/utility-processes.md) |
| `invokeUtility` | page | utility process | any value or promise | [Calling a utility process from a renderer](../processes/utility-from-renderer.md) |
| `streamUtility` | page | utility process | `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` | [Calling a utility process from a renderer](../processes/utility-from-renderer.md) |
| `invokeFromWorker` | service worker | main process | any value or promise | [Service workers](../processes/service-workers.md) |
| `sendFromWorker` | service worker | main process | `void` or `Promise<void>` | [Service workers](../processes/service-workers.md) |
| `askWorker` | main process | service worker | any value or promise | [Service workers](../processes/service-workers.md) |
| `emitToWorker` | main process | service worker | `void` or `Promise<void>` | [Service workers](../processes/service-workers.md) |

The verbs fall into four kinds, which decide what the return type may be:

- A **one-way** verb (`send`, `emit`, `notifyUtility`, `notifyMain`, `sendFromWorker`, `emitToWorker`) sends a
  message and gets no answer. Together with the **port** verbs (`port`, `mainPort`) it must return `void`,
  `Promise<void>`, or a union of those. Any other return type is an error.
- A **request** verb (`invoke`, `ask`, `callUtility`, `callMain`, `invokeUtility`, `invokeFromWorker`,
  `askWorker`) gets an answer, so its signature may return any value, or a promise of it.
- A **stream** verb (`stream`, `streamUtility`) must return an `AsyncIterable<Chunk>`,
  `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>` of the global types. `Chunk` is the type of what
  the stream sends, one value at a time. A signature with another return type is an error.
- A signature never takes a `this` parameter, since IPC does not transfer `this`.

The signature is a function type, so its parameters keep their names, and they may be optional (`n?: number`)
or a rest parameter (`...rest: string[]`). A destructured parameter is given the name `arg0`, `arg1`, ... (by
its position) in the generated code. Whatever the signature sends has to survive the structured clone
algorithm, see [What can be sent](what-can-be-sent.md).

## Type arguments

A verb takes the signature as its first type argument. The verbs that can fail with a typed error (`invoke`,
`stream`, `invokeUtility`, `streamUtility` and `invokeFromWorker`) take the error types as an optional second
one:

```ts
getUser: invoke<(id: number) => Promise<User>, NotFoundError | AuthError>(),
```

The error types are documented in the generated `types.ts` and in the typings of the renderer. See
[Errors](../channels/invoke.md#errors) for how a page receives them. The other verbs take exactly one type
argument, and a verb that gets more is an error (`'send' takes exactly one type argument, the signature.`; for
the five above, `'invoke' takes at most two type arguments, the signature and the error types.`).
The signature can also be given after the call with [`as`](as-form.md), which cannot declare error types.

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

A channel that is given an option its verb does not accept is an error when the bindings are generated, and so
is an unknown option:

```text
Schema file 'src/autoipc/schema.ts' (6:26): channel 'c': option 'timeoutMs' is not supported by 'send'.
```

### What each option does

| Option | Value | Default | Effect |
|--------|-------|---------|--------|
| `allowedOrigins` | a non-empty array of origin strings, such as `["app://.", "http://localhost:5173"]` | any origin | Only a caller with one of these origins is let in. See [Sender validation](../security/sender-validation.md). |
| `validate` | the name of a Standard Schema that the schema file imports | none | The arguments are checked before the handler runs. See [Validating arguments](../security/validating-arguments.md). |
| `timeoutMs` | a non-negative integer | the `timeoutMs` option of the config (`0` unless you set it) | The call is rejected after that many milliseconds without an answer. `0` turns the timeout off for this channel, and a value above 2147483647 counts as 2147483647 (about 24.8 days). `streamUtility` does not take the default of the config: it waits for ever unless it has its own `timeoutMs`. |
| `highWaterMark` | a non-negative integer, or `Infinity` | `1024` | The most chunks that the generator may be ahead of the reader. See [stream](../channels/stream.md). |
| `maxQueue` | a non-negative integer, or `Infinity` | `1000` | The most messages that a port channel queues while it has no port. See [Bounded send queues](../processes/send-queues.md). |
| `trigger` | the name of a `BrowserWindow` event | none | Generates `bind`, which sends when the event fires. See [emit](../channels/emit.md). |
| `scopes` | a non-empty array of scope names | all windows | Gives the channel only to the windows of these scopes. See [Scopes](../security/scopes.md). |

The values of the options are read from the source text, so they must be written as literals:

| Option | Value |
|--------|-------|
| `allowedOrigins`, `scopes` | an array of string literals |
| `trigger` | a string literal |
| `timeoutMs` | a non-negative integer literal |
| `maxQueue`, `highWaterMark` | a non-negative integer literal, or `Infinity` |
| `validate` | the name of a value that the schema file imports (a named or a default import) |

A variable, a computed value or a spread in a config is an error. `validate` cannot be a type-only import, a
namespace import or a declaration of the schema file itself, since the generated main bindings import it as a
value from the module that the schema file imports it from.

The values are checked when the bindings are generated:

- An origin is a scheme, a host and an optional port in lower case, with no path, wildcard or credentials. The
  port is a number from 0 to 65535, and it is left out when it is the default of the scheme (`:443` for
  `https`, `:80` for `http`), since Chromium leaves it out too, so such an origin would never match. An empty
  list is an error as well, since it would let nobody in.
- A scope name is lower case letters and digits, joined by dashes and starting with a letter, up to 32
  characters, such as `settings` or `plugin-host`. `default` is the scope of the channels without `scopes`, so
  it cannot be used, and a name cannot be listed twice.
- A `trigger` is one of the events in the list of [emit](../channels/emit.md).

## Errors

Errors in how a verb is used are reported with the file, the position and the channel, and a code frame of the
spot (see [Reading schema errors](../getting-started/channel-maps.md#reading-schema-errors)):

| Message | Cause |
|---------|-------|
| `unknown verb '<name>'. Use one of: invoke, send, ...` | The channel is declared with something that is not a verb of this library. |
| `expected a call to one of: invoke, send, ...` | The value of the channel is not a call at all. |
| `no signature. Write send<(arg: string) => void>() or send() as (arg: string) => void.` | The verb has neither a type argument nor `as`. |
| `the signature must be a function type, found '<type>'.` | The signature is not written as `(...) => ...`. |
| `a 'this' parameter is not supported, since IPC does not transfer 'this'.` | The signature takes `this`. |
| `the signature is given twice, as a type argument and with 'as'. ...` | Both forms are used, see [The `as` form](as-form.md). |
| `the signature of '<verb>' must return AsyncIterable<Chunk>, AsyncIterableIterator<Chunk> or AsyncGenerator<Chunk>, found '<type>'.` | A stream verb returns something else. |
| `'<verb>' accepts one optional config object literal.` | The config is a variable, a spread or a second argument. |
| `'<verb>' config keys must be plain identifiers.` | The config has a quoted or computed key, or a spread. |
| `option '<name>' is not supported by '<verb>'.` | See the table of options above. |
| `option '<name>' must be an array of string literals.` or `must be a string literal.` | The value of `allowedOrigins`, `scopes` or `trigger` is not a literal. |
| `option 'timeoutMs' must be a non-negative integer literal, found '<text>'.` | Also for `-1`, `1.5` and a variable. A value above 9007199254740991 is refused too. |
| `option 'maxQueue' must be a non-negative integer literal or Infinity, found '<text>'.` | The same for `highWaterMark`. Above 9007199254740991, use `Infinity`. |
| `option 'validate' must be an identifier which the schema file imports.` | `validate` is a call or a member, such as `z.string()`. |
| `option 'validate' refers to '<name>', which is not imported in the schema file. ...` | The name is not an import, or it is declared in the schema file itself. |
| `option 'validate' refers to '<name>', which is a type-only import. Import it as a value.` | The name comes from `import type` or `import { type name }`. |
| `option 'validate' refers to '<name>', a namespace import. ...` | Import the schema by name, `import { schema } from "..."`. |
| `Channel return type '<type>' not allowed when channel kind is 'Broadcast'` | A one-way verb returns something but `void`. The message says `'Port'` for `port` and `mainPort`. It has no position. |

The values of `allowedOrigins`, `scopes` and `trigger` are checked in a separate step, and their messages start
with `At path: <option> -- `, for example:

```text
At path: scopes -- 'default' is the scope of the channels without scopes. Choose another name
```

They give neither the file nor the channel, so search the schema for the value they quote.
