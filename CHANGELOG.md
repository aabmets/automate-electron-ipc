# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-10

Changes since v0.2.6, the last published release, following a
feature-completeness audit of that version against the Electron
documentation. This is not a drop-in from 0.2.6: the way channels are
declared, the names of the generated API, and the wire channel names
changed. The `ipcgen` command and the schema file location are
unchanged.

### Removed

- The `Channel("X").<Direction>.<Kind>({ ... })` declaration syntax,
  replaced by `defineChannels`
- The `listeners` option; call `.on()` once per subscriber
- The main-process export name `ipcMain`, which shadowed the Electron
  object; it is `ipc` now, as `window.ipc` in the page

### Changed

- **Channels are declared in an exported `defineChannels` map.** The key
  is the channel name, a verb helper (`invoke`, `send`, `emit`, `port`,
  ...) picks the pattern, and the signature is a type argument
  (`invoke<Sig>()`, or `invoke() as Sig`)
- **The generated API is one namespace per channel**: `ipc.<name>.on`,
  `.handle`, `.send`, and so on, in main and in the page
- **`send` always sends immediately.** A trigger is a separate
  `ipc.<name>.bind(win, provider)`. Before, every `send` call added a
  `win.on(trigger)` listener that was never removed and replayed the
  arguments of the first call
- **Wire channel names carry the prefix `autoipc:`** (`getUser` travels
  as `autoipc:getUser`). `channelPrefix` changes it, and `""` turns it
  off
- Errors thrown in a `handle` callback reach the page as typed errors
  with `name`, `message`, `code`, and `data`, not as `Error invoking
  remote method 'X'`
- Schema errors name the file with the line and column of the problem
  and print a code frame, and several errors are reported together
- Generated files start with a header that names the schema. Files that
  a removed channel, scope, or option left behind are reported as stale,
  and removed by a run
- The output order is deterministic and independent of the locale
- The generated `main.ts` and `utility.ts` compile under
  `noUnusedLocals` and `noUnusedParameters`
- The sources, types, and tests are split into modules of at most 300
  lines, grouped in directories, and `bun run check` enforces the limit
- CI runs type check and lint, Vitest on Node 22, Node 24, and Bun, an
  e2e type-check job, and tests in a real Electron process

### Added

- `on` and `handle` return disposers, `once` and `handleOnce` exist, and
  registering a handler for the same channel again replaces the old one.
  The `on` of the page returns an unsubscribe function
- Targets of `send`: `BrowserWindow`, `WebContents`, `WebContentsView`,
  and `WebFrameMain`. `broadcast` sends to all windows, with a filter,
  and `sendToSender(event, ...)` answers the frame that called
- `ask` channels: main asks a page and awaits the answer, with a timeout
- `stream` channels: an `async function*` in main becomes an
  `AsyncIterable` in the page, with cancellation through `AbortSignal`
  and backpressure through a credit window
- `port` channels between two windows, with a robust lifecycle (reloads,
  late windows, close handling, several listeners) and one-to-many
  connections through `onConnection`; `maxQueue` bounds the send queue
- `mainPort` channels: a `MessagePortMain` between main and a page, for
  high-frequency data
- `utilityProcess` channels (`MainToUtility`, `UtilityToMain`) with a
  generated `utility.ts`, and page to utility process channels over a
  port that main brokers
- Service worker channels (`ServiceWorkerToMain`, `MainToServiceWorker`,
  Electron 35 and later) with a generated service worker preload
- `webContents` option of `handle` and `on`: handlers scoped to one
  window through `webContents.ipc`
- `scopes`: one preload and one typings file per scope, and main rejects
  calls from windows outside the scope of a channel
- Composable preload: it exports `api` and `expose(key)`, `autoExpose`
  controls the side effect, `exposeAs` sets the key, and
  `isolatedWorldId` uses `exposeInIsolatedWorld`
- `getPathForFile` option: a wrapper of `webUtils.getPathForFile` in the
  exposed API
- `serializer` option: a module with `serialize` and `deserialize`,
  applied to invoke, port, utility, and service worker channels
- `timeoutMs` for `invoke` channels with a global default, and timeouts
  for calls to utility processes and service workers
- `validateSender` hook and the channel option `allowedOrigins`,
  compared against the parsed origin of `senderFrame`
- The channel option `validate`: runtime validation of arguments with
  any Standard Schema (zod, valibot, arktype). A failure rejects with
  `IpcValidationError`
- Structured-clone checks at generation time: functions, symbols,
  `WeakMap`, `WeakSet`, and promises in arguments are errors, and class
  instances are warnings
- Config file, `--cwd`, and `--config`, and the output path options
  `mainBindingsPath`, `preloadBindingsPath`, and `rendererTypesPath`
  with the flags `--out-main`, `--out-preload`, and `--out-types`
- `ipcgen --check` lists out-of-date generated files, and `ipcgen
  --watch` regenerates on every change
- Programmatic API `automate-electron-ipc/api` with `generate` and
  `check`
- Vite and electron-vite plugin `automate-electron-ipc/vite`
- `projectUsesNodeNext` is detected from `tsconfig.json`, following a
  relative `extends`
- `format` option (`biome` or `prettier`) that formats the generated
  files
- Helper types `ChannelName`, `ChannelArgs<N>`, `ChannelReturn<N>`, and
  `IpcApi`
- `mock` option: a generated `mock.ts` with stubs of the API for tests
  of the page
- `hooks` option: React hooks or Vue composables (`useIpcEvent`,
  `useIpcInvoke`)
- Documentation site (MkDocs Material) with a migration guide and a
  security guide

### Fixed

- The schema directory crashed on Node, and duplicate channels and
  listeners across schema files were not detected
- Types from value imports were dropped, a repeated namespace import
  produced a bogus import, and import paths with dots in the file name,
  script extensions, JSON modules, or directory imports (`package.json`,
  path mappings) were wrong
- Wrong generated types, rest parameters that lost their spread, async
  return types detected by prefix, and parameter names that clashed with
  generated names
- Type names that collided across schema files, or clashed with
  generated names or built-in globals
- Qualified names, `typeof`, destructuring, decorators, `import =`, and
  `export { X }` in schema files
- Non-ASCII schema sources corrupted the output, because swc spans are
  UTF-8 byte offsets
- An empty `window.d.ts` was invalid, and a schema with only `port`
  channels generated invalid code
- The project root was wrong in monorepos, and config values that were
  accepted broke the output
- `port` channels never paired while `isLoading()` was true, and
  `connect` left an entry behind when a window was destroyed
- `ask` on a destroyed window threw a `TypeError`, and an `ask` never
  settled when the page reloaded, navigated, or crashed
- Calls to a utility process that had already exited hung forever
- Listeners grew with every call, stream, connection, or subscription,
  in main and in the preload
- The page-load watch took error pages and aborted navigations for loads
- Synchronous errors of the preload script lost their fields across
  `contextBridge`
- A scope that was removed left its typings file behind, and the
  generated preload had double blank lines
- The test suite failed under Bun, depended on test order, and left
  temporary directories behind

[Unreleased]: https://github.com/aabmets/automate-electron-ipc/compare/1.0.0...HEAD
[1.0.0]: https://github.com/aabmets/automate-electron-ipc/releases/tag/1.0.0
