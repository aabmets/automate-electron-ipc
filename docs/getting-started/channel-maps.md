# Channel maps

The schema of your app is one or more TypeScript files, and each file exports a channel map: an object passed to
`defineChannels`. This page explains how `ipcgen` reads those files, the rules they must follow and how to
read the errors it reports.

```ts
import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getVersion: invoke<() => string>(),
   logLine: send<(line: string) => void>(),
});
```

The key of each property is the channel name, the verb helper (`invoke`, `send`, ...) picks the kind of the
channel, and the type argument of the verb is the signature. See [Verbs](../schema/verbs.md) for all verbs and
their options.

The schema file is never executed by Node. Instead, this library parses it to deduce the meanings behind the
declarations, so the config of a verb must be written as an object literal. If the file is run anyway, the
verbs return nothing, and the first call prints the warning `IPC automation channel expressions have no effect
when executed by JavaScript.`

Since this library is well-documented through its type definitions, the developer is encouraged to use an IDE
which facilitates easy type inference and hints within its user interface. To that end, include the generated
files in your projects, as described in [TypeScript configuration](../tooling/typescript-configuration.md). The
typings of the renderer take the types of the API from `types.ts`, which is written next to them (see
[Helper types](../renderer/helper-types.md)).

!!! note
    IPC automation does not make a distinction between senders/listeners and invokers/handlers as they are
    defined in the IPC documentation of the Electron library. Whether an IPC component is generated as a
    sender/listener or invoker/handler under the hood depends on the verb of the channel. The reason behind
    this design choice was to allow you to focus on IPC arguments and return types without having to concern
    yourself with IPC internals.

## Where the schema files live

`ipcgen` looks in the IPC data directory (the [`ipcDataDir`](../tooling/configuration.md) option, `src/autoipc` by default):

- A file named `schema.ts` holds the map of a small app.
- A directory named `schema` holds one map per file, to structure and segment the channels of a larger app.
  All files of the directory and of its subdirectories are read: the `.ts`, `.mts` and `.cts` files, but not
  the `.d.ts` files. A file without a `defineChannels` call, such as one with shared types or validators, adds
  no channels.
- If both exist, `schema.ts` is read and the `schema` directory is ignored.

A schema that has no files at all is explained in the [Quickstart](quickstart.md). One that has files but no
channels writes empty bindings and prints `Skipping IPC automation, because no channels were found in path:`
with the path.

## Rules of the schema file

- Export the map with `export default defineChannels({...})` or `export const channels = defineChannels({...})`.
  A map that is declared first and exported later (`export default channels` or `export { channels }`) works
  too. `export =` does not.
- Use only one `defineChannels` call per file. Its one argument must be an object literal.
- Import the verbs from `automate-electron-ipc`. Aliased imports work, such as
  `import { invoke as call } from "automate-electron-ipc"`, and so do namespace imports, such as `ipcLib.invoke()`
  after `import * as ipcLib from "automate-electron-ipc"`.
- Channel names are plain identifier keys of any length and case, such as `ok`, `on` or `onReady`. Spreads,
  computed keys, quoted keys, shorthand properties, methods and nested objects are not supported.
- Each channel becomes an object named after its key, such as `ipc.echoUserName`. Names that every object has,
  such as `constructor` or `toString`, are rejected.
- Channel names are unique across all the schema files. Two files that declare the same name are an error.
- While the config `getPathForFile` is on, no channel can be named `getPathForFile`, and while `mock` is on, none
  can be named `emit` or `ask`, since the API of the page has members of those names.

### Types in a signature

A signature may use any type that TypeScript knows in the schema file:

- Global types, such as `string`, `Date`, `Map` or `Record`, need nothing.
- A type that you declare in the schema file (an interface, a type alias, an enum, a class or a namespace)
  must be exported if a channel uses it, because the generated files import it from the schema file. A type
  that no channel uses may stay private. The same goes for a value that a signature names with `typeof`.
- A type that you import into the schema file, with `import type` or a plain import, is imported again in the
  generated files that need it. The paths are rewritten for the directory of each generated file. An
  `import("./models").User` type works too.
- If two schema files declare types of the same name, or a type has the name of something the generated files
  declare, the generated files import it under another name, such as `User_2`. Nothing needs renaming.

## Reading schema errors

A mistake in the schema fails the run: the message is printed and the exit code is `1`. An error that comes from
the source of the schema starts with the file and the position (line and column) and the channel, and is
followed by a code frame of the spot. Mistakes in the declarations of the channels are reported together, up to
20 of them, in the order of the files and the lines:

```text
 ✖ – IPC automation failed:
     Schema file '/home/me/app/src/autoipc/schema.ts' (4:66): channel 'getUser': option 'timeoutMs' must be a non-negative integer literal, found '1.5'.

     3 | export default defineChannels({
     4 |    getUser: invoke<(id: number) => Promise<string>>({ timeoutMs: 1.5 }),
       |                                                                  ^~~
     5 |    logLine: send<(line: string) => void>({ timeoutMs: 100 }),

     Schema file '/home/me/app/src/autoipc/schema.ts' (5:44): channel 'logLine': option 'timeoutMs' is not supported by 'send'.

     4 |    getUser: invoke<(id: number) => Promise<string>>({ timeoutMs: 1.5 }),
     5 |    logLine: send<(line: string) => void>({ timeoutMs: 100 }),
       |                                            ^~~~~~~~~
     6 | });

     2 errors
```

If there are more than 20, the report ends with `and N more errors` before the total. A file that is not valid
TypeScript is reported as `Syntax error in schema file '<file>:<line>:<column>': <reason>`, together with the
errors of the other files.

The checks that follow stop at the first problem, so fix the mistakes you are shown and run again. These have
less context: a few have no code frame, the ones for `allowedOrigins`, `scopes` and `trigger` have neither the
position nor the channel (see [Verbs](../schema/verbs.md#errors)), and those about the signature are described
in [What can be sent](../schema/what-can-be-sent.md).

The mistakes in the shape of the map and its channels:

| Message | Cause |
|---------|-------|
| `the defineChannels call must be exported, with 'export default defineChannels({...})' or 'export const <name> = defineChannels({...})'.` | The call is not exported. |
| `'export =' is not supported in a schema file. ...` | The file uses `export = X`. Use `export default`. |
| `only one defineChannels call is allowed per file.` | The file has a second call. Move it to another file. |
| `defineChannels accepts one object literal.` | The argument is a variable, a spread or missing. |
| `spread elements are not allowed in a channel map.` | The map contains `...other`. |
| `channel names must be plain identifier keys, found a <kind>.` | A key is computed or quoted, or the property is a shorthand or a method. |
| `channel '<name>': nested objects are not supported in a channel map.` | The value of a channel is an object. |
| `Channel name '<name>' is reserved, since it is a member of every object. Choose another name.` | The name is `constructor`, `toString` and the like. |
| `Channel name '<name>' is declared in both '<file>' (<line>:<column>) and '<file>' (<line>:<column>). Channel names must be unique across the application.` | Two files declare the same name. |
| `Channel name '<name>' is reserved, since the config '<option>' adds a member of that name to the API. Rename the channel, or turn the config off.` | See the rules above. |
| `Type '<type>' is used by channel '<name>' and must be exported. Add 'export' to its declaration.` | A type of the schema file is used by a channel, but not exported. |

Errors in how a channel uses its verb, its signature and its options are listed on the
[Verbs](../schema/verbs.md#errors) page.
