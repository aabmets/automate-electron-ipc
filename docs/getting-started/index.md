# Getting started

This section takes you from an empty project to a working typed channel. You write a schema that lists the
channels of your app, run `ipcgen` to generate the typed code, and use that code in the main process and in
the page.

| Page | What it covers |
|------|----------------|
| [Installation](installation.md) | Installing the package, the Node and Electron versions, running `ipcgen`. |
| [Quickstart](quickstart.md) | A step-by-step walk-through: one request from a page, one message to the main process. |
| [Channel maps](channel-maps.md) | How the schema file is read, its rules, and how to read its errors. |
| [Simple example](simple-example.md) | The smallest useful setup, with all three files. |

Using electron-vite? [electron-vite end to end](../tooling/electron-vite.md) is the quickstart for its project layout.
After this section, [Schema](../schema/index.md) describes everything a schema can declare.
