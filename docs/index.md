# Automate Electron IPC

A Node library that generates the IPC components of an Electron app from one typed schema. You declare
channels in a TypeScript file; `ipcgen` writes the main-process objects, the preload script and the typings
of the page, so that both sides of every call are checked by the compiler.

## Features

1. Declarative IPC schema using a typed channel map
2. Generation of one typed object per channel for the main process, `ipc.<name>`
3. Generation of preload bindings for renderer processes
4. Generation of typehints for the `ipc` object of the renderer, also reachable as `window.ipc`
5. Automatic import of user-defined types for generated components
6. BrowserWindow event triggers for `emit` channels
7. `ask` channels, with which the main process asks a renderer and awaits the answer
8. `stream` channels, with which the main process streams results to a renderer, which can cancel
9. Typed channels between the main process and a `utilityProcess`, in a generated `utility.ts`
10. Typed calls and streams from a renderer straight to a `utilityProcess`, over a port that the main
    process brokers
11. Scopes, which give each kind of window its own API and keep the others out in the main process
12. Typed channels between the main process and a service worker (Electron 35 or later, experimental),
    with a generated preload script and typings for the worker
13. Optional React hooks or Vue composables for the channels of a page, in a generated `hooks.react.ts` or `hooks.vue.ts`
14. A generated mock of the API of the page for renderer tests, Storybook and a plain browser

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
