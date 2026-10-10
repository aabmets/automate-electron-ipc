# Schema

The schema is the source of truth of the library. It is a TypeScript file that declares every channel of the
application: its name, its verb, its signature and its options. `ipcgen` reads the schema and generates the
bindings for the main process, the preload script, the renderer and, where the schema uses them, the utility
processes and service workers. The schema file is never executed by Node. This library parses it, so the
config of a verb must be written as an object literal.

This section covers what you can write in a schema:

- [Verbs](verbs.md): the helpers that declare a channel, the direction of each one and the options that it takes.
- [The generated API](generated-api.md): the methods that each verb gets in the main process and in the renderer.
- [What can be sent](what-can-be-sent.md): the types that the structured clone algorithm accepts, and the checks that `ipcgen` makes.
- [Custom serializers](custom-serializers.md): sending values that the structured clone algorithm cannot carry, such as class instances.
- [The `as` form](as-form.md): the alternative way to write a signature.

How the schema file itself is laid out (the channel map, `defineChannels` and where the files live) is described in
[Channel maps](../getting-started/channel-maps.md).
