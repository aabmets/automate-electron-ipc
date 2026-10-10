# Migrating from 0.2.x

Version 1.0.0 is a breaking release. It declares channels with a `defineChannels` map and verbs instead of
`Channel(...)` statements, and it renames the generated API. Nothing tells a 0.2 project what to change: a
schema in the old syntax is not an error, since `Channel(...)` statements are ignored. `ipcgen` writes empty
bindings and prints the warning that no channels were found, and the schema file fails to type-check, because
`Channel` and `type` are gone from the package.

These pages list every breaking change since 0.2.6, in the order in which you meet them.

## Steps

1. Update the package, and Node to 22.13 or later (see [Package and Node version](config-and-behavior.md#package-and-node-version)).
2. Rewrite the schema ([Rewriting the schema](schema-rewrite.md#rewriting-the-schema)).
3. Run `ipcgen`, then change the call sites with the table in [Generated names](schema-rewrite.md#generated-names).
4. Include the new `types.ts` in the renderer project (see [Generated files](../tooling/generated-files.md)), and commit the regenerated files, which have a new header and a new order.
5. Read the [changes in behavior](config-and-behavior.md#changes-in-behavior): the channel names on the wire, the errors of `invoke`, and the stricter checks can all change what an app does.

## Pages

| Page | Covers |
|------|--------|
| [Rewriting the schema](schema-rewrite.md) | From `Channel(...)` statements to a channel map, and the new names of the generated API |
| [Configuration and behavior](config-and-behavior.md) | The config and the command line, the generated files, changes in behavior, the package and the Node version |
