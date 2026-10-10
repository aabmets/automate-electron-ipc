# Security

An IPC channel is a door from the page into the main process, which has the rights of the user. This section gathers what the library does to guard that door, what it leaves to you, and how the pieces map to the [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security).

The generated bindings give you three tools. Each is off until you ask for it, so a schema that sets none of them checks nothing about who calls.

- [Sender validation](sender-validation.md) limits a channel to the frames you trust, with `allowedOrigins` and `configureIpc({ validateSender })`.
- [Validating arguments](validating-arguments.md) checks the arguments of a call against a Standard Schema before your handler runs.
- [Scopes](scopes.md) give each window its own API, enforced in the main process.

## Pages

- [Threat model](threat-model.md): what the library assumes about a renderer, and the checks that are on without any option.
- [Sender validation](sender-validation.md): `allowedOrigins`, `configureIpc`, `validateSender` and `onRejected`.
- [Validating arguments](validating-arguments.md): the `validate` option and `IpcValidationError`.
- [Scopes](scopes.md): a different API per window, `registerScope`, and the per-scope generated files.
- [Putting it together](putting-it-together.md): a complete example with two windows, scopes, origins and validators.
- [The Electron security checklist](checklist.md): which checklist items the library covers and which stay yours.
