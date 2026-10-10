# Sender validation

By default, any frame of any window can call every `invoke`, `send` and `stream` channel, iframes and child windows included. This page shows how to restrict a channel to the callers you trust.

## allowedOrigins

Restrict a channel with `allowedOrigins`:

```typescript
export default defineChannels({
   readSecret: invoke<(id: number) => Promise<string>>({
      allowedOrigins: ["app://.", "http://localhost:5173"],
   }),
});
```

An origin is a scheme, a host and an optional port, in lower case, without a path, a wildcard or credentials. The list must hold at least one origin, since an empty list would allow no caller, and a port that is the default of its scheme (`https://example.com:443`) is refused, because Chromium leaves it out of the origin, so it could never match. Write `https://example.com` instead. `ipcgen` reports these mistakes when it reads the schema.

The generated main bindings compare the origin for equality with `event.senderFrame.origin`, never as a prefix, so `http://localhost:5173.attacker.com` does not match. A call without a frame (`senderFrame` is `null` once the frame is gone) is always rejected, as soon as any check (origins, a validator or scopes) applies to the channel.

`allowedOrigins` is accepted by `invoke`, `send` and `stream`, and by the channels that a service worker calls in the main process (see [Service workers](../processes/service-workers.md)).

## configureIpc and validateSender

For rules that depend on more than the origin, call `configureIpc` once at start-up. Its `validateSender` runs for every `invoke`, `send` and `stream` channel, in addition to `allowedOrigins`: a call needs to pass both. A validator which throws or returns anything but `true` rejects the call.

```typescript
import { configureIpc, IpcForbiddenError } from "./main";

configureIpc({
   validateSender: (event, channel) => event.sender === mainWindow.webContents,
   onRejected: (event, channel) => console.warn("Rejected", channel, event.senderFrame?.url),
});
```

## Rejected calls

A rejected `invoke` throws an `IpcForbiddenError` in the main process, which the renderer sees as a rejected promise (Electron passes on the message of the error only). The same holds for the start of a `stream`. A rejected `send` is dropped. `onRejected` is called for all of them, and a hook that throws does not change the outcome.

`configureIpc` replaces the previous configuration, and `configureIpc({})` removes it. Channels with neither `allowedOrigins` nor a validator (nor `scopes`) are not checked. `once` and `handleOnce` are not used up by a rejected call.

When a channel in the schema has a `validate` option, `onRejected` also receives the error as a third argument, an `IpcForbiddenError` or an [`IpcValidationError`](validating-arguments.md).

## Order of the checks

A call passes the scope first, then `allowedOrigins`, then `validateSender`, and has to pass all of them. Only then are the arguments decoded and validated, so a rejected sender reaches no code of your serializer or your schema. See [Scopes](scopes.md) and [Validating arguments](validating-arguments.md).
