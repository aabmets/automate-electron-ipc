# Scopes

An app with a privileged settings window and a sandboxed window for content or plugins wants a different API for each. This page shows how to give each window its own channels, and how the main process enforces it.

## Declaring scopes

By default every window gets every channel. Put a channel in scopes with `scopes`:

```typescript
export default defineChannels({
   // Open to all windows, also to the ones that are in no scope.
   getVersion: invoke<() => Promise<string>>(),
   // The settings window only.
   saveSettings: invoke<(settings: Settings) => Promise<void>>({ scopes: ["settings"] }),
   // The settings window and the editor window.
   notify: send<(text: string) => void>({ scopes: ["settings", "editor"] }),
   openFile: invoke<(path: string) => Promise<string>>({ scopes: ["editor"] }),
});
```

`scopes` is accepted by `invoke`, `send`, `emit`, `ask`, `stream`, `port`, `mainPort`, `invokeUtility` and `streamUtility`, which are the channels that a page takes part in. The channels between the main process and a utility process or a service worker have no `scopes`.

The API of a scope is its own channels and the ones without `scopes`.

### Writing a scope name

The option must be an array of string literals. A scope name starts with a lower case letter and is made of lower case letters and digits joined by dashes, at most 32 characters long, such as `settings` or `plugin-host`. `ipcgen` reports a mistake when it reads the schema:

| Mistake | Message of `ipcgen` |
|:--|:--|
| An empty list | `scopes must list at least one scope, since an empty list puts the channel in no window` |
| The name `default` | `'default' is the scope of the channels without scopes. Choose another name` |
| A bad name | `'<value>' is not a scope name. Use lower case letters and digits, joined by dashes and starting with a letter, up to 32 characters, such as 'settings' or 'plugin-host'` |
| A name twice in one list | `scope '<value>' is listed twice` |

## One set of files per scope

`ipcgen` writes `preload.<scope>.ts`, `window.<scope>.d.ts` and `types.<scope>.ts` next to the usual files, here `preload.settings.ts`, `window.settings.d.ts`, `types.settings.ts`, `preload.editor.ts`, `window.editor.d.ts` and `types.editor.ts`.

The usual `preload.ts`, `window.d.ts` and `types.ts` are the API of a window that is in no scope, so they have only the channels without `scopes`: all of them in a schema that uses no scopes. The [hooks](../renderer/framework-hooks.md) and the [mock](../renderer/mocking.md) are written for that API only.

Use the file of its scope as the preload script of each window, and include only one `window*.d.ts` in a renderer project, since each of them declares the same global. A scope that you remove from the schema has its `preload.<scope>.ts`, `window.<scope>.d.ts` and `types.<scope>.ts` deleted by the next run, like the other [stale files](../tooling/generated-files.md#stale-files).

## The main process admits a call by the scope of the window

The preload script is only the API of the page, and a compromised page can call `ipcRenderer` itself, so the generated `main.ts` also checks. It exports `registerScope` and the type `IpcScope` (the union of the scope names of the schema), and you register each window in its scope:

```typescript
import { registerScope } from "./autoipc/main";

const settings = new BrowserWindow({ webPreferences: { preload: settingsPreload, sandbox: true } });
registerScope(settings, "settings");   // a window, a view or contents
```

`registerScope(target, scope)` takes a `BrowserWindow`, a `WebContentsView` or a `WebContents`.

A call to an `invoke`, `send` or `stream` channel with `scopes` is admitted only from contents that are registered in one of them. Contents that are in no scope, which includes every window that you did not register, can call the channels without `scopes` only.

| Channel | A call from the wrong scope |
|:--|:--|
| `invoke` | Rejected with an `IpcForbiddenError`, code `IPC_FORBIDDEN` |
| `stream` | The same rejection, as the first read of the stream |
| `send` | Dropped |

In each case the handler does not run, and `onRejected` of `configureIpc` hears of it, as it does for `allowedOrigins`. See [Rejected calls](sender-validation.md#rejected-calls) for what the page sees.

The scope is checked first, then `allowedOrigins`, then `validateSender`, and a call has to pass all of them. See [Sender validation](sender-validation.md).

## Registration

`registerScope` returns a function that removes the registration. The registration is also removed when the contents are destroyed, and registering the same contents again replaces it (the function of the earlier registration then does nothing). It belongs to the contents, so every frame of the window has the scope, and `allowedOrigins` still tells them apart.

Register a window before its page loads, so that no call arrives from contents that are in no scope.

`registerScope` throws a `TypeError` in two cases:

- A scope that the schema does not declare: `The scope '<name>' is not declared in the schema. Use one of: <the declared scopes>`. The throw is there because the mistake would otherwise lock the window out without a word.
- Contents that are already destroyed: `Object has been destroyed`.

## What scopes do not guard

Only the calls of a page to the main process are guarded there. For `emit`, `ask`, port and utility channels `scopes` decides the API of the page: you pick the window that you send to or connect, and a window whose preload script lacks the channel has no listener for it.
