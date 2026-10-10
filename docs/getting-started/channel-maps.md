# Channel maps

IPC automation reads channels from a channel map: an object passed to `defineChannels` that is exported from a schema file.
The key of each property is the channel name, the verb helper picks the kind of the channel, and the type argument
of the verb is the signature. The schema file is never executed by Node. Instead, this library parses it to deduce
the meanings behind the declarations, so the config of a verb must be written as an object literal.

Since this library is well-documented through its type definitions, the developer is encouraged to use an IDE
which facilitates easy type inference and hints within its user interface. To that end, include the generated
files in your projects, as described in [TypeScript configuration](../tooling/typescript-configuration.md). The typings of
the renderer take the types of the API from `types.ts`, which is written next to them (see
[Helper types](../renderer/helper-types.md)).

!!! note
    IPC automation does not make a distinction between senders/listeners and invokers/handlers as they are
    defined in the IPC documentation of the Electron library. Whether an IPC component is generated as a
    sender/listener or invoker/handler under the hood depends on the verb of the channel. The reason behind
    this design choice was to allow you to focus on IPC arguments and return types without having to concern
    yourself with IPC internals.

## Rules of the schema file

- Export the map with `export default defineChannels({...})` or `export const channels = defineChannels({...})`.
- Use only one `defineChannels` call per file. In a `schema` directory, each file may have its own map.
- Channel names are plain identifier keys of any length and case, such as `ok`, `on` or `onReady`. Spreads, computed keys and nested objects are not supported.
- Each channel becomes an object named after its key, such as `ipc.echoUserName`. Names that every object has, such as `constructor` or `toString`, are rejected.
- Aliased imports work, such as `import { invoke as call } from "automate-electron-ipc"`.
