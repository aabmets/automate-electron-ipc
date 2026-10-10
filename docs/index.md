# Automate Electron IPC

A Node library that generates the IPC components of an Electron app from one typed schema. You declare
channels in a TypeScript file; `ipcgen` writes the main-process objects, the preload script and the typings
of the page, so that both sides of every call are checked by the compiler.

## How it works

1. **Declare.** Each channel of the app gets a name, a verb that says what kind of channel it is, and a
   signature, in a schema file.
2. **Generate.** `ipcgen` reads the schema and writes the typed code next to it. The schema is parsed and never
   executed.
3. **Use.** The main process calls `ipc.<name>` from the generated `main.ts`, and the page calls `ipc.<name>`
   from the API that the generated preload script exposes.

```ts
import { defineChannels, invoke } from "automate-electron-ipc";

export default defineChannels({
   getVersion: invoke<() => string>(),
});
```

With that schema, the main process answers with `ipc.getVersion.handle(() => app.getVersion())` and the page
asks with `await ipc.getVersion.invoke()`, which the compiler knows to be a `string`. The
[Quickstart](getting-started/quickstart.md) shows all the steps.

## Features

- A declarative IPC schema: one typed channel map.
- One typed object per channel for the main process, `ipc.<name>`, and the matching preload bindings and
  typings for the page, `ipc` (also reachable as `window.ipc`).
- Your own types are imported into the generated files for you.
- Five kinds of channels between the main process and a page: `invoke`, `send`, `emit`, `ask` and `stream`.
  An `emit` channel can fire on a `BrowserWindow` event, an `ask` channel lets the main process ask a page
  and await the answer, and a `stream` channel streams results to a page, which can cancel.
- Message-port channels between two pages, or between a page and the main process.
- Typed channels between the main process and a `utilityProcess`, in a generated `utility.ts`, and typed calls
  and streams from a page straight to a `utilityProcess`, over a port that the main process brokers.
- Typed channels between the main process and a service worker (Electron 35 or later, experimental), with a
  generated preload script and typings for the worker.
- Scopes, which give each kind of window its own API and keep the others out in the main process.
- Optional React hooks or Vue composables for the channels of a page, in a generated `hooks.react.ts` or
  `hooks.vue.ts`.
- A generated mock of the API of the page for renderer tests, Storybook and a plain browser.

## Where to go

| Section | What you find there |
|---------|---------------------|
| [Getting started](getting-started/index.md) | Installation, a quickstart and the rules of the schema file. |
| [Tooling](tooling/index.md) | Configuration, the command line, the Node API, Vite and TypeScript setup. |
| [Schema](schema/index.md) | The verbs, the generated API, serializers and what can be sent. |
| [Channels](channels/index.md) | `invoke`, `send`, `emit`, `ask` and `stream`. |
| [Processes](processes/index.md) | Ports, utility processes and service workers. |
| [Renderer](renderer/index.md) | Helper types, React and Vue hooks, and the mock. |
| [Security](security/index.md) | Sender validation, argument validation and scopes. |
| [Migration](migration/index.md) | Moving from 0.2.x to 1.0. |
| [Contributing](contributing/index.md) | Building the library and running its tests. |
