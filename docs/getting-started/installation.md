# Installation

This page installs the package and runs the generator. The package is a development tool: only the files it
generates end up in your app.

## Install the package

Install the package as a development dependency, with the one line that matches your package manager:

```bash
bun add automate-electron-ipc --dev
pnpm add automate-electron-ipc --save-dev
yarn add automate-electron-ipc --dev
npm install automate-electron-ipc --save-dev
```

## Requirements

The package needs Node 22.13 or later to run. `electron` is an optional peer dependency (30 or later),
since only the generated files talk to it. The generated files have no runtime dependency on this library.

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

`ipcgen` works on the project that contains the folder you run it in: the project root is the nearest
`package.json`, searching upwards. Run it from anywhere inside the project, or pass `--cwd`. It fails with
`Cannot find the project root: no package.json in '<dir>' or any parent directory.` outside of a project.
`ipcgen --version` prints the version of the package, which is a quick way to check the install.

New to the library? Continue with the [Quickstart](quickstart.md). See the
[command line](../tooling/command-line.md) page for all flags, and [Configuration](../tooling/configuration.md)
for the options.
