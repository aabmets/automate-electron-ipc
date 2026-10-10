# Sender validation

By default, any frame of any window can call every `invoke`, `send` and `stream` channel, iframes and child windows included. This page shows how to restrict a channel to the callers you trust: per channel with `allowedOrigins`, and for all channels with `configureIpc`.

## allowedOrigins

Restrict a channel with `allowedOrigins`:

```typescript
export default defineChannels({
   readSecret: invoke<(id: number) => Promise<string>>({
      allowedOrigins: ["app://.", "http://localhost:5173"],
   }),
});
```

The generated main bindings compare the origin of the calling frame, `event.senderFrame.origin`, for equality with each listed origin, never as a prefix, so `http://localhost:5173.attacker.com` does not match.

`allowedOrigins` is accepted by `invoke`, `send` and `stream`, and by the channels that a service worker calls in the main process, which have `configureServiceWorkerIpc` in place of `configureIpc` (see [Service workers](../processes/service-workers.md)). The other verbs reject it when `ipcgen` reads the schema.

### Writing an origin

An origin is a scheme, a host and an optional port, in lower case, without a path, a wildcard or credentials: `app://.`, `http://localhost:5173`, `https://example.com`. The option must be an array of string literals.

`ipcgen` reports a mistake when it reads the schema, so a bad origin never reaches the main process:

| Mistake | Message of `ipcgen` |
|:--|:--|
| An empty list | `allowedOrigins must list at least one origin, since an empty list allows no caller` |
| Not an origin, such as a path, a wildcard or upper case | `'<value>' is not an origin. Write the scheme, the host and an optional port, in lower case and without a path, wildcard or credentials, such as 'app://.' or 'http://localhost:5173'` |
| A port that is not a number from 0 to 65535 | `'<value>' has the port '<port>', which is not a number from 0 to 65535. Write the port in digits, such as 'http://localhost:5173'` |
| The default port of the scheme (80 for `http` and `ws`, 443 for `https` and `wss`, 21 for `ftp`) | For `https://example.com:443`: `'https://example.com:443' has the default port of its scheme, which no origin has, so it never matches a caller. Write 'https://example.com'` |

Chromium leaves the default port out of an origin, which is why `https://example.com:443` could never match. Write `https://example.com` instead.

## configureIpc and validateSender

For rules that depend on more than the origin, call `configureIpc` once at start-up. Its `validateSender` runs for every `invoke`, `send` and `stream` channel, in addition to `allowedOrigins`: a call needs to pass both. A validator that throws, or returns anything but `true`, rejects the call.

```typescript
import { configureIpc } from "./autoipc/main";

configureIpc({
   validateSender: (event, channel) => event.sender === mainWindow.webContents,
   onRejected: (event, channel) => console.warn("Rejected", channel, event.senderFrame?.url),
});
```

Both hooks get the Electron event of the call, `IpcMainInvokeEvent` for `invoke` and `stream` and `IpcMainEvent` for `send`, and the name of the channel as it is in the schema.

- `configureIpc` exists in `main.ts` when the schema has an `invoke`, `send` or `stream` channel.
- `configureIpc` replaces the previous configuration, and `configureIpc({})` removes it.
- Channels with none of `allowedOrigins`, `scopes` and a `validateSender` are not checked.
- A call without a frame is always rejected, as soon as any check (origins, a validator or scopes) applies to the channel. Electron sets `senderFrame` to `null` once the frame is gone.

## Rejected calls

What happens to a call that does not pass:

| Channel | Result |
|:--|:--|
| `invoke` | The handler does not run. The main process throws an `IpcForbiddenError`, and the promise in the page is rejected with `{ name: "IpcForbiddenError", message: "The sender of the message is not allowed to use the channel '<name>'", code: "IPC_FORBIDDEN" }` |
| `stream` | The same rejection, as the first read of the stream |
| `send` | The message is dropped |

With `rawErrors`, an `invoke` is rejected with the text that Electron makes of the error instead, and there is no `code`. See [Errors](../channels/invoke.md#errors).

`IpcForbiddenError` is exported by `main.ts`. It is an `Error` with the fields `code` (`"IPC_FORBIDDEN"`) and `channel`.

`onRejected` is called for every rejected call, and a hook that throws does not change the outcome. When a channel in the schema has a `validate` option, `onRejected` also receives the reason as a third argument, an `IpcForbiddenError` or an [`IpcValidationError`](validating-arguments.md). `once` and `handleOnce` are not used up by a rejected call.

## Order of the checks

A call passes the frame check first, then the scope, then `allowedOrigins`, then `validateSender`, and has to pass all of them. Only then are the arguments decoded and validated, so a rejected sender reaches no code of your serializer or your schema. See [Scopes](scopes.md) and [Validating arguments](validating-arguments.md).
