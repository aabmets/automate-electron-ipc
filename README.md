# Automate Electron IPC

[![Node LTS](https://img.shields.io/node/v-lts/automate-electron-ipc?style=flat&label=node&color=%231B7EBC)](https://nodejs.org/en/download/prebuilt-installer/current)
[![NPM License](https://img.shields.io/npm/l/automate-electron-ipc)](https://github.com/aabmets/automate-electron-ipc/blob/main/LICENSE)
[![Code Coverage](https://codecov.io/gh/aabmets/automate-electron-ipc/graph/badge.svg?token=xg3PJRlo3o)](https://codecov.io/gh/aabmets/automate-electron-ipc)
[![NPM Downloads](https://img.shields.io/npm/dw/automate-electron-ipc)](https://www.npmjs.com/package/automate-electron-ipc)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)<br/>
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=bugs)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=aabmets_automate-electron-ipc&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=aabmets_automate-electron-ipc)

### Description

Node library for generating IPC components for Electron apps. You declare your channels once in a typed
schema; `ipcgen` generates the main-process objects, the preload bindings and the typings of the renderer, so
both sides of every call are checked by the compiler.

**Documentation: <https://aabmets.github.io/automate-electron-ipc/>** (the sources are in the [`docs/`](docs) folder).


### Features

- Declarative IPC schema using a typed channel map
- One typed object per channel for the main process, `ipc.<name>`, and generated preload bindings and typings for the renderer
- `invoke`, `send`, `emit`, `ask` and `stream` channels, plus ports, `utilityProcess` and service worker channels
- Scopes, sender validation and argument validation in the main process
- Optional React hooks or Vue composables, and a generated mock of the API for renderer tests


### Installation

```bash
npm install automate-electron-ipc --save-dev
```

Node 22.13 or later is required, and `electron` (30 or later) is an optional peer dependency. See
[Installation](https://aabmets.github.io/automate-electron-ipc/getting-started/installation/) for other package managers.


### Quickstart

Run `npx ipcgen` once to create the IPC data directory (`src/autoipc`), then write the schema in `src/autoipc/schema.ts`:

```ts
import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   // The page asks, the main process answers.
   getVersion: invoke<() => string>(),
   // The page tells the main process something, and gets no answer.
   logLine: send<(line: string) => void>(),
});
```

Run `npx ipcgen` again (or keep `ipcgen --watch` running) to write `main.ts`, `preload.ts`, `window.d.ts` and
`types.ts` next to the schema. Use the bindings in the main process:

```ts
import { app } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   ipc.getVersion.handle(() => app.getVersion());
   ipc.logLine.on((_event, line) => console.log(line));
});
```

Load the generated `preload.ts` as the preload script of your windows, and call the API from the page:

```ts
ipc.logLine.send("Asking for the version");
const version: string = await ipc.getVersion.invoke();
```

The full walk-through, with the preload and TypeScript setup, is in the
[Quickstart](https://aabmets.github.io/automate-electron-ipc/getting-started/quickstart/).


### Documentation

Everything else is in the [documentation](https://aabmets.github.io/automate-electron-ipc/): configuration,
every channel kind, utility processes and service workers, security, and migrating from 0.2.x.


### License

Apache-2.0, see [LICENSE](LICENSE).
