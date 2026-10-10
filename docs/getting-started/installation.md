# Installation

Install the package as a development dependency; only the generated files end up in your app.

```bash
bun add automate-electron-ipc --dev
pnpm add automate-electron-ipc --save-dev
yarn add automate-electron-ipc --dev
npm install automate-electron-ipc --save-dev
```

Use the one line that matches your package manager.

## Requirements

The package needs Node 22.13 or later to run. `electron` is an optional peer dependency (30 or later),
since only the generated files talk to it.

## Running the generator

The generator is the `ipcgen` command, so run it with `npx ipcgen` (or `bunx`, `pnpm exec`, `yarn`), or
put it in a script:

```json
{
   "scripts": {
      "ipc": "ipcgen",
      "ipc:check": "ipcgen --check"
   }
}
```

New to the library? Continue with the [Quickstart](quickstart.md). See the
[command line](../tooling/command-line.md) page for all flags.
