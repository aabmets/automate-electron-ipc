# What can be sent

Arguments and results travel by the structured clone algorithm. `ipcgen` checks every signature against it, so a
mistake is found when the bindings are generated and not when the channel is used. This page lists what the check
reports as an error, what it reports as a warning, and what it does not follow.

## Errors

These stop the generation:

- A **function type**, `Function`, `symbol`, `unique symbol`, `WeakMap` or `WeakSet` in a parameter or a return type.
  Constructor types and object types with method or call signatures count as functions. Electron throws
  `An object could not be cloned` for all of them. Send plain data instead, and use a channel to call back.
- A **`Promise`** (or a `PromiseLike`) in a parameter, or anywhere in a result except at the outermost position. See
  [Promises](#promises).

An error names the channel and the place, for example:

```text
Channel 'a': parameter 'cb' contains a function ('() => void'). It cannot be sent over IPC, and Electron throws
'An object could not be cloned'. Send plain data instead, and use a channel to call back.
```

The check looks inside arrays, tuples, unions, object members, type arguments, type parameter constraints, and the
aliases, interfaces and generic types that the schema file declares. When the offending type is reached through a
declaration, the message adds the path, such as `through 'Payload'`.

## Warnings

An instance of a **class declared in the schema file** is a warning, not an error. The instance arrives as a plain
object without its prototype and methods. Use an interface or a type alias for the data, or configure a
[custom serializer](custom-serializers.md) that revives the class. The warning is printed while the bindings are
generated, and the generation goes on.

## Promises

The result of an async signature may be a `Promise`, since that is how it is awaited: a request channel such as
`invoke` awaits it, and a one-way channel may return `Promise<void>`. The `Promise` is allowed only as the outermost
type of the result, also inside a union or behind a local alias. `Promise<Promise<number>>`, an object with a
`Promise` member and a `Promise` in a parameter are errors, because Electron cannot clone a `Promise`. A result of
`Awaited<T>` is checked as the type that `T` resolves to.

The same checks apply to the type of the chunks of a `stream` channel, not to the iterable that the signature returns.

## What is not followed

The check is made from the text of the schema file, so it does not evaluate types. These are never reported:

- Types that come from other files, including a qualified name such as `Models.User`.
- `typeof` queries, `import("...")` types, `infer` types, literal types and template literal types.
- The arguments of the utility types `Parameters`, `ReturnType`, `InstanceType`, `ConstructorParameters`, `Exclude`,
  `Extract`, `Omit` and `Pick`, since their results are not made of their arguments as they are.
- The checked type and the `extends` type of a conditional type. Only its two branches are checked.
