# Roadmap and work tracker

Source: the feature-completeness audit of v0.2.6 (2026-10-08). It compared the library against the
official Electron docs (IPC tutorial, ipcMain/ipcRenderer, contextBridge, MessagePorts,
utilityProcess, security checklist, breaking changes up to v44).

The session protocol is in `CLAUDE.md`.

- One task = one commit = one session.
- Status: `[ ]` todo, `[x]` delivered, `[-]` dropped (kept so task IDs stay stable).
- `Bn` refers to the audit's confirmed bug list.

---

## Phase 0: Declaration syntax and test infrastructure

### [ ] T00: New channel declaration syntax: a `defineChannels` map with verb helpers
- **Goal:** replace `Channel("X").<Direction>.<Kind>({ signature: type as Sig, ...rest })` with an
  exported channel map. The key is the channel name, a verb helper picks the pattern, and the
  signature is a type argument on the verb. That generic form is the main form.
  `verb(config?) as Sig` is also accepted as an alternative:
  ```ts
  import { defineChannels, invoke, send, emit, port } from "automate-electron-ipc";

  export default defineChannels({
     /** Doc comments are kept for later use in window.d.ts. */
     getUser: invoke<(id: number) => Promise<User>>({ timeoutMs: 5 }),
     echoUserName: send<(userName: string) => void>(),
     progress: emit<(n: number) => void>({ listeners: ["onBar"], trigger: "focus" }),
     chat: port<(msg: string) => void>(),

     // Alternative `as` form, same result:
     getUserAlt: invoke({ timeoutMs: 5 }) as (id: number) => Promise<User>,
  });
  ```
  - The channel map is exported: `export default defineChannels({...})` or
    `export const <name> = defineChannels({...})`. Being exported, it is a real typed value that
    app code and generated code can `import type` from (T44).
  - Verbs replace the direction × kind grid: `invoke` = RendererToMain Unicast, `send` =
    RendererToMain Broadcast, `emit` = MainToRenderer Broadcast, `port` = RendererToRenderer Port.
    Later tasks add `ask` (T23), `stream` (T27) and the utility/service-worker verbs (T29, T36).
  - The generic form is the main form: TypeScript checks the config against the signature, and it
    is the only form that can carry error types (T18). The `as` form reads options-first, but its
    config is not checked against the signature.
  - This is breaking; bump to 0.3.0. The old syntax is removed, not kept alongside.
- **Scope:**
  - **`types/index.d.ts`:**
    - Each verb is `verb<S extends Fn = never>(config?: VerbConfig<NoInfer<S>>)`. It returns a
      branded `ChannelDef<S>` when `S` is given and `unknown` when it is not, so the `as` form
      type-checks.
    - Per-verb config interfaces: `listeners` only on `send`/`emit`, `trigger` only on `emit`.
      Options that depend on the signature (`validate` in T17) take `Parameters<S>` when `S` is
      given and are unconstrained when it is not.
    - `defineChannels<T extends Record<string, unknown>>(channels: T): T`.
    - Remove `Channel`, the `signature` config key and the `type` export.
    - Verified with tsc 7.0.2: both forms compile; a schema that does not match the generic
      signature is rejected; using both forms on one channel is rejected with TS2352.
    - Update the JSDoc examples.
  - **`src/index.ts`:** runtime stubs for `defineChannels` and the verbs, matching the new types.
  - **`src/parser.ts`:**
    - A schema file declares its channels in one exported channel map:
      `export default defineChannels({...})` or `export const <name> = defineChannels({...})`.
      Record which export it is, for T44. Resolve the verb and `defineChannels` names through the
      file's imports from `automate-electron-ipc`, so aliased imports work.
    - Each property is `name: verb<Sig>(config?)` or `name: verb(config?) as Sig` (unwrap
      parentheses). Either `TsFunctionType` provides the signature: params, return type, custom
      types, async.
    - Config keys (`listeners`, `trigger`) are read from the optional object-literal argument.
    - Errors, each naming the file and the channel:
      - no signature, or both a type argument and `as`;
      - a signature that is not a function type (TypeScript accepts `invoke() as string`);
      - an unknown verb, a spread, a computed or non-identifier key, or a nested object (reserved
        for T20/T33 groups);
      - an option that the verb does not support;
      - more than one `defineChannels` call in a file;
      - a `defineChannels` call that is not exported (not assigned, or assigned to a non-exported
        `const`);
      - a leftover `Channel(...)` statement or `signature:` key, with a message explaining the
        migration.
    - Remove `channelPattern`, the `is*Assignment` helpers and all regex-on-source-text matching in
      favor of AST checks.
  - **`src/validators.ts`:** unchanged semantics. Map verbs to the existing kind/direction specs
    internally, so the writers do not change in this task.
  - **Tests:**
    - Rewrite all parser tests and test utils (`tests/test_parser/*`, `tests/utils/*`) to the new
      syntax.
    - Add cases for:
      - each verb, in both forms, with and without config;
      - a parenthesized `as` expression;
      - aliased imports;
      - default and named exports of the map;
      - async return;
      - rest, optional and destructured params;
      - each error case above.
    - A type-level test (tsc on a fixture) for the verified typing behavior above.
  - **README:** write every example in the generic form. Document the `as` form in one short
    section as an alternative, noting what it loses. Add a short "Migrating from 0.2" note.
- **Depends on:** none
- **Delivered:**

### [ ] T01: E2E harness, and fix schema-dir crash on Node (B1)
- **Problem:** `src/automation.ts` calls `fsp.exists`, which exists only in Bun. Under Node the
  documented `schema/` directory mode throws `TypeError: fsp.exists is not a function`.
  `automation.ts` has no tests at all.
- **Scope:**
  - Remove the `fsp.exists` call; `stat` already proves the file exists.
  - Add `tests/test_e2e/`. It contains fixture projects under `tests/fixtures/` (a single
    `schema.ts`, and a `schema/` directory with nested files). A helper copies a fixture into a temp
    dir, runs `ipcAutomation` with the cwd/project root pointed at it, and returns the three
    generated files.
  - Add a type-check helper that compiles the generated `main.ts`, `preload.ts` and `window.d.ts`
    against the repo's pinned `electron` types (tsc `--noEmit`, with a tiny tsconfig in the temp
    dir).
- **Tests:**
  - Regression: directory mode runs under Node (vitest runs on Node).
  - The e2e test for each fixture produces files that type-check.
  - Tests may be marked `it.fails`/`todo` for B2–B7 until those tasks land, with a comment
    referencing the task.
  - Fixtures use the T00 syntax.
- **Depends on:** T00
- **Delivered:**

---

## Phase 1: Bug fixes

### [ ] T02: Global duplicate channel and listener validation (B2)
- **Problem:** `validateChannelSpecs` runs per file, so duplicate channel names and listener names
  across files go undetected. The result is duplicate object keys in the output (TS error), and
  Electron throws because a second handler is registered.
- **Scope:** validate uniqueness across all parsed files after parsing. The error message names both
  files.
- **Tests:** unit test, plus an e2e regression test with two schema files defining the same channel.
- **Depends on:** T01
- **Delivered:**

### [ ] T03: Custom types from value imports are dropped (B3)
- **Problem:** only `import type` / `import { type X }` are recorded. `import { Settings } from "..."`
  used in a signature makes the generated files reference `Settings` without importing it.
- **Scope:** record every named or default import whose local name appears in a channel signature's
  type positions, and emit it as `import type` in the generated files. Also handle default imports
  (`import Foo from`) correctly.
- **Tests:** parser unit tests, plus an e2e test where the output type-checks.
- **Depends on:** T01
- **Delivered:**

### [ ] T04: Rest parameters lose their spread in generated call sites (B4)
- **Problem:** `getOriginalParams(spec, true)` drops `...`. `(...values: number[])` generates
  `webContents.send('X', values)`, so the renderer receives a single array argument.
- **Scope:** emit `...name` for rest params at every call site (main senders, and anywhere else
  `onlyNames` is used).
- **Tests:** writer unit tests for rest, optional and destructured params, plus an e2e test.
- **Depends on:** T01
- **Delivered:**

### [ ] T05: Wrong generated types (B6, B7)
- **Problem:**
  - Unicast handlers in `main.ts` type the event as `IpcMainEvent`; Electron passes
    `IpcMainInvokeEvent`.
  - RendererToMain Broadcast senders are typed `=> Promise<void>` in `window.d.ts` but call
    `ipcRenderer.send`, which returns `undefined`.
- **Scope:**
  - Use `IpcMainInvokeEvent` for Unicast.
  - Type Broadcast senders as returning `void`.
  - Drop the `any` casts in the `main.ts` handler wrappers where feasible, so the declared signature
    is actually enforced.
- **Tests:** writer unit tests, plus an e2e type-check.
- **Depends on:** T01
- **Delivered:**

### [ ] T06: Deterministic output ordering (B8)
- **Problem:** schema files are read with `Promise.all` and pushed in completion order. The order of
  generated imports and members churns between runs.
- **Scope:** sort files by relative path. Keep the channel order stable within a file. Sort import
  declarations.
- **Tests:** running the generator twice (with shuffled `readdir` results via a mock) gives
  byte-identical output.
- **Depends on:** T01
- **Delivered:**

### [ ] T07: Correct project root resolution (monorepos)
- **Problem:** `resolveUserProjectPath` walks upward from the *library's install location* to the
  first `.git`. In monorepos and workspaces that is the repo root, not the Electron app package, so
  the wrong `package.json` config is read and output lands in the wrong place.
- **Scope:** resolve the project root as the nearest `package.json` upward from `process.cwd()`, and
  accept an explicit override (used by T37's `--cwd`). Keep `searchUpwards` caching correct when the
  cwd changes.
- **Tests:** unit tests for a nested workspace layout, plus an e2e test from a subpackage.
- **Depends on:** T01
- **Delivered:**

### [ ] T08: Schema file filtering, and surfacing parse errors
- **Problem:**
  - Every file under `schema/` is read, including `.md`, `.json`, etc.
  - swc parse errors are swallowed, so a typo produces "no channels found" instead of an error.
- **Scope:**
  - Only read `*.ts`, `*.mts` and `*.cts`, ignoring `*.d.ts`.
  - Report parse errors with file path and line:column, and exit non-zero.
- **Tests:** unit tests for the filter. A regression test that a syntax error is reported, not
  ignored.
- **Depends on:** T01
- **Delivered:**

### [ ] T09: Type-definition edge cases
- **Problem:**
  - Any non-exported type in a schema file throws, even if no channel uses it.
  - `export default interface X` is imported as `import type { X }`, which is wrong.
  - Generic type params (`<T>(x: T) => T`) are collected as custom types.
  - `ImportsGenerator` never marks local typeSpec imports as seen, so they can be duplicated.
  - Built-in global types (`Array`, `Record`, `Map`, `Date`, `Uint8Array`, ...) are treated as
    custom types.
- **Scope:**
  - Only require `export` on types that are actually referenced by a channel.
  - Fix default-export imports.
  - Exclude in-scope generic params and well-known globals.
  - Dedupe local type imports.
- **Tests:** parser and imports-generator unit tests for each case, plus an e2e type-check.
- **Depends on:** T01
- **Delivered:**

### [ ] T10: Stale metadata and packaging dependencies (B10)
- **Problem:**
  - `types/internal.d.ts` imports a non-existent `IpcAutomationPlugin`.
  - The README says "uses the TypeScript library" (it uses swc).
  - The generated notice says "PLUGIN".
  - `chalk`, `commander` and `superstruct` are runtime imports but are declared as
    peerDependencies, so users must install them by hand.
  - `electron` is not needed by the generator.
- **Scope:**
  - Remove the stale export.
  - Fix the wording.
  - Move runtime deps to `dependencies`, or replace `chalk` with `node:util.styleText`.
  - Make `electron` an optional peer.
- **Tests:** a test that imports `cli.ts`/`automation.ts` with only `dependencies` available
  (assert `package.json` deps cover every bare import in `src/`).
- **Depends on:** none
- **Delivered:**

### [ ] T11: CI on Node, plus e2e type-check job
- **Problem:** CI runs vitest under Bun only, which is how B1 shipped.
- **Scope:**
  - Add a Node 22/24 matrix to `.github/workflows/vitest-codecov.yaml`.
  - Run the e2e suite (including the type-check of generated output) in CI.
  - Run `bun run check` in CI.
- **Tests:** the workflow itself; verify locally with `node`.
- **Depends on:** T01
- **Delivered:**

### [ ] T12: Redesign `trigger` (B5)
- **Problem:** with `trigger`, `send<X>(win, ...args)` registers a new `win.on(trigger)` listener on
  *every* call, never removes it, never sends immediately, and replays the arguments from the first
  call forever.
- **Scope:**
  - `send<X>` always sends immediately.
  - Triggers become a separate generated `bind<X>(win, provider: () => Args | Promise<Args>)`. It
    registers once, calls the provider on each trigger, and returns a disposer.
  - Validate trigger names against the documented BrowserWindow events list at generation time.
- **Tests:**
  - Regression: N calls produce 0 extra listeners.
  - The disposer removes the listener.
  - The provider is evaluated per event.
- **Depends on:** T04
- **Delivered:**

---

## Phase 2: Core API, listener lifecycle and security

### [ ] T13: Naming of generated API members
- **Decision needed:** confirm the naming scheme with the user before starting. This is a breaking
  change to generated code; bump to 0.3.0.
- **Proposal:**
  - Main: Unicast uses `handle<X>`; Broadcast keeps `on<X>`.
  - Renderer: Unicast uses `invoke<X>`; Broadcast keeps `send<X>`.
  - Rename the exported `ipcMain` object (which shadows Electron's own `ipcMain`) to e.g. `ipc` or a
    configurable name.
- **Scope:**
  - Implement the chosen names.
  - Keep validation of `listeners` names consistent.
  - Document the migration in the README.
- **Tests:** writer unit tests, plus an e2e test.
- **Depends on:** T05
- **Delivered:**

### [ ] T14: Renderer listener disposers and `once`
- **Problem:**
  - Preload `on<X>` returns the `ipcRenderer` object and cannot be unsubscribed.
  - Since contextBridge re-proxies functions on every crossing, a separate `off(cb)` cannot work.
  - Frameworks (React StrictMode, Vue/Svelte remounts) accumulate duplicate listeners.
- **Scope:**
  - The preload wrapper keeps its own reference and returns
    `() => ipcRenderer.removeListener(ch, wrapper)`, typed `() => void` in `window.d.ts`.
  - Generate `once<X>`. The callback still never receives the `IpcRendererEvent`.
- **Tests:**
  - Writer unit tests.
  - A runtime test of the generated preload with a mocked `ipcRenderer`/`contextBridge`: subscribe,
    dispose, no further calls.
  - Assert the returned value is a function, not `ipcRenderer`.
- **Depends on:** T13
- **Delivered:**

### [ ] T15: Main-process listener and handler disposers and `handleOnce`
- **Problem:**
  - Main `on<X>` and Unicast registration return nothing removable.
  - Registering a Unicast handler twice throws (window recreation, dev hot restart).
- **Scope:**
  - Return disposers (`ipcMain.off` / `ipcMain.removeHandler`).
  - Add `once<X>` / `handleOnce<X>`.
  - Re-registering a Unicast handler either replaces the old one safely or throws a descriptive
    error. Choose one and document it.
- **Tests:** runtime tests of generated `main.ts` with a mocked `electron` module.
- **Depends on:** T13
- **Delivered:**

### [ ] T16: Sender validation (Electron security checklist #17)
- **Problem:** no generated handler checks `event.senderFrame`. Any frame, including iframes and
  child windows, can call every channel.
- **Scope:**
  - The generated `main.ts` exports `configureIpc({ validateSender?: (event, channel) => boolean })`.
  - Add a per-channel schema option `allowedOrigins: ["app://.", "http://localhost:5173"]`, compared
    against the parsed `senderFrame.origin`, never URL prefix matching.
  - Read `senderFrame` synchronously before any `await`; since v33 it can become `null`/detached.
    A null frame means reject.
  - Rejected calls: Unicast rejects with a typed `IpcForbiddenError`; Broadcast drops and calls an
    optional `onRejected` hook.
- **Tests:**
  - Runtime tests with mocked events: allowed origin, wrong origin, `null` senderFrame,
    `example.com.attacker.com` bypass attempt, global validator plus per-channel rule interplay.
  - Parser and validator tests for `allowedOrigins`.
- **Depends on:** T15
- **Delivered:**

### [ ] T17: Runtime argument validation (Standard Schema)
- **Problem:** renderer input is untrusted and TS types are erased at runtime.
- **Scope:**
  - Add a per-channel schema option `validate: SomeSchema`. It must be an identifier imported in the
    schema file, referencing a Standard Schema (`~standard`) for the argument tuple (zod, valibot,
    arktype, ...).
  - The generated `main.ts` value-imports it and validates before invoking the handler. On failure:
    Unicast rejects with `IpcValidationError` (with issues), Broadcast drops and reports to the hook.
  - In the generic form, `validate` is typed against `Parameters<Sig>` (set up in T00).
  - Optional: derive the TS signature from the schema's inferred input type when no signature is
    given.
  - Do not add a runtime dependency; use the spec only.
- **Tests:**
  - Parser tests for value-import detection.
  - Runtime tests with a hand-written Standard Schema stub: valid, invalid, async validator.
  - e2e type-check.
- **Depends on:** T16
- **Delivered:**

### [ ] T18: Typed error envelope for Unicast
- **Problem:** errors thrown in `handle` reach the renderer only as
  `Error invoking remote method 'X': Error: msg`. Class, `code`, custom fields and cause are lost.
- **Scope:**
  - The main wrapper catches errors and returns `{ ok: false, error: { name, message, code?, data? } }`
    (or `{ ok: true, value }`). The preload unwraps and rethrows an `IpcError` with those fields.
  - Let the schema declare error types so `window.d.ts` documents them.
    - Generic form: a second type argument, `invoke<Sig, NotFoundError | AuthError>()`.
    - The `as` form has no slot for errors. Document that errors need the generic form.
  - Opt-out config for raw Electron behavior.
- **Tests:** runtime round-trip tests (thrown Error, thrown custom error with code/data, thrown
  non-Error value), plus an e2e type-check.
- **Depends on:** T15
- **Delivered:**

### [ ] T19: Structured-clone awareness in signatures
- **Problem:**
  - Electron throws when sending Functions, Promises (other than invoke results), Symbols, WeakMaps
    or WeakSets.
  - Class instances lose their prototype.
  - None of this is checked.
- **Scope:**
  - At generation time, error on parameter or return types that are or contain `Function`, function
    types, `symbol`, `WeakMap`, `WeakSet`, or `Promise` in parameters.
  - Warn on types that resolve to classes declared in the schema file.
- **Tests:** validator unit tests for each forbidden form, including nested object and array members.
- **Depends on:** T08
- **Delivered:**

### [ ] T20: Channel name prefix / namespacing
- **Problem:** raw channel names like `GetUser` can collide with other libraries or app code using
  `ipcMain` directly.
- **Scope:** add a config option `channelPrefix` (default e.g. `"autoipc:"`) applied to the wire
  channel names only. API member names are unchanged.
- **Tests:** writer tests, plus an e2e test.
- **Depends on:** T13
- **Delivered:**

---

## Phase 3: Missing Electron features

### [ ] T21: Main → renderer targets and broadcast-to-all
- **Problem:**
  - `send<X>` only accepts a `BrowserWindow`. `WebContentsView` (which replaced `BrowserView`) and
    bare `WebContents` are unsupported.
  - "Broadcast" cannot send to all windows (theme or settings sync).
- **Scope:**
  - `send<X>(target: BrowserWindow | WebContents | WebContentsView, ...args)`.
  - Add `broadcast<X>(...args, opts?: { filter?: (wc) => boolean })` over
    `webContents.getAllWebContents()`, skipping destroyed contents.
- **Tests:** runtime tests with a mocked electron for each target type, destroyed-contents skipping,
  and the filter.
- **Depends on:** T12
- **Delivered:**

### [ ] T22: Frame-targeted sends
- **Problem:** there is no way to reply to the specific iframe that sent a request
  (`webFrameMain.send` / `webContents.sendToFrame`).
- **Scope:**
  - Accept `WebFrameMain` as a `send<X>` target.
  - Add a helper `send<X>.toSender(event, ...args)` that targets `event.senderFrame`, capturing it
    synchronously.
- **Tests:** runtime tests, including a detached/null frame.
- **Depends on:** T21
- **Delivered:**

### [ ] T23: `ask` channels (main asks a renderer and awaits the answer)
- **Problem:** Electron has no invoke from main to a renderer. A real need is "unsaved changes?" on
  `close`/`before-quit`, or fetching editor state before save.
- **Scope:**
  - New verb `ask<Sig>(config?)`; the `as` form from T00 also works.
  - The main side gets `invoke<X>(target, ...args, { timeoutMs? }): Promise<R>`, built on a
    correlation ID over `send` plus a reply channel (or a per-request `MessageChannelMain`).
  - Reject on timeout, on target destroyed, and when the renderer has no handler registered.
  - The renderer side gets `handle<X>(cb)` with a disposer, single responder.
  - Errors use T18's envelope.
- **Tests:** runtime tests with both sides mocked: success, timeout, destroyed target, handler error,
  concurrent requests resolved out of order.
- **Depends on:** T18, T21
- **Delivered:**

### [ ] T24: Robust port lifecycle (B9)
- **Problem:**
  - `propagate` posts ports only on `once('ready-to-show')`, so ports are lost if the window is
    already shown or the page reloads.
  - Preload `sendMessage`/`onMessage` throw before the port arrives.
  - Only one `onmessage` handler is allowed.
  - There is no close handling.
- **Scope:**
  - Deliver immediately if loaded, else on `did-finish-load`. Re-pair after a reload of either side.
  - `propagate` returns a handle with `close()`.
  - The preload queues outgoing messages until the port is ready, supports multiple subscribers with
    disposers, and exposes `onReady`/`onClose`.
- **Tests:** runtime tests: late window, reload, queued sends flushed in order, close events, multiple
  subscribers.
- **Depends on:** T14
- **Delivered:**

### [ ] T25: One-to-many port topologies
- **Problem:** one port channel name supports exactly one pair of windows. A hub window with N child
  windows, or a "worker window" serving several UI windows, is impossible.
- **Scope:**
  - `connect<X>(a, b)` returns a connection handle. A window may hold multiple connections per
    channel.
  - The renderer API exposes connections (e.g. `onConnection(cb)`), each with
    `sendMessage`/`onMessage`/`close`.
- **Tests:** runtime tests with 1 hub and 3 peers, closing one peer.
- **Depends on:** T24
- **Delivered:**

### [ ] T26: Main ↔ renderer port channels
- **Problem:** high-frequency data such as log tailing, audio meters or progress pays per-message
  `ipcMain` overhead. Electron recommends `MessagePortMain` for this, but no main-side port endpoint
  is generated.
- **Scope:**
  - New schema kind for a main ↔ renderer port.
  - The main gets a typed `MessagePortMain` wrapper (`start()`, `postMessage`, `on('message')`,
    `'close'`).
  - The renderer gets the same API as T24.
- **Tests:** runtime tests with a mocked `MessageChannelMain`.
- **Depends on:** T24
- **Delivered:**

### [ ] T27: Streaming results with cancellation
- **Problem:** downloads, exports, ffmpeg jobs and LLM token streams need progress and cancellation.
  There is no streaming kind.
- **Scope:**
  - New verb `stream<(opts: O) => AsyncIterable<Chunk>>()`; the `as` form from T00 also works.
  - The main handler is an `async function*`.
  - Transport is a per-call `MessageChannelMain`: chunks, then `end`/`error`, then `close`.
  - The renderer gets `stream<X>(...args, { signal?: AbortSignal }): AsyncIterable<Chunk>`. Abort
    propagates to main and calls `return()` on the generator.
- **Tests:** runtime tests: full stream, abort mid-stream, error mid-stream, backpressure-free
  ordering.
- **Depends on:** T18, T24
- **Delivered:**

### [ ] T28: Invoke timeouts
- **Problem:** a hung main handler leaves the renderer's promise pending forever.
- **Scope:**
  - Per-channel `timeoutMs` schema option, plus a global default in config.
  - The preload races the invoke and rejects with `IpcTimeoutError`.
- **Tests:** runtime tests with fake timers.
- **Depends on:** T18
- **Delivered:**

### [ ] T29: utilityProcess channels
- **Problem:** `utilityProcess` is Electron's recommended home for CPU-heavy or crash-prone work
  (SQLite, indexing, native modules). It only has untyped `postMessage`/`parentPort`, with no
  request/response.
- **Scope:**
  - New directions `MainToUtility` and `UtilityToMain`, with Broadcast and Unicast (correlation IDs).
  - A new generated file `utility.ts` for the child, on `process.parentPort`.
  - Typed wrappers in `main.ts` around a `UtilityProcess` instance.
  - Configurable output path.
- **Tests:** runtime tests with mocked `parentPort` and `UtilityProcess`: request/response, errors,
  exit while pending.
- **Depends on:** T18
- **Delivered:**

### [ ] T30: Renderer ↔ utility process via a brokered port
- **Problem:** the renderer cannot talk directly to a utility process, so every DB query hops through
  main.
- **Scope:**
  - The main brokers a `MessageChannelMain` between a window and a `UtilityProcess`.
  - The renderer gets typed invoke/stream calls over the port; the utility side gets handlers.
- **Tests:** runtime tests with mocks.
- **Depends on:** T26, T29
- **Delivered:**

### [ ] T31: Configurable exposure key and isolated worlds
- **Problem:** the API is hard-coded as `window.ipc`, and `contextBridge.exposeInIsolatedWorld` is
  unsupported.
- **Scope:**
  - Config `exposeAs` (default `"ipc"`).
  - Optional `isolatedWorldId` (validate ≥ 1000 per docs) that uses `exposeInIsolatedWorld`.
  - `window.d.ts` follows the key.
- **Tests:** writer tests, plus an e2e type-check.
- **Depends on:** T13
- **Delivered:**

### [ ] T32: Composable preload output
- **Problem:** the generated `preload.ts` calls `exposeInMainWorld` as a side effect, so it cannot be
  combined with app-specific preload code or exposed under several keys.
- **Scope:**
  - Export `const api = {...}` and `export function expose(key = "<exposeAs>")`.
  - Keep a config switch to auto-expose for backward compatibility.
- **Tests:** writer tests, plus a runtime test with a mocked `contextBridge`.
- **Depends on:** T31
- **Delivered:**

### [ ] T33: Per-window API scopes (least privilege)
- **Problem:** every window gets every channel. Apps with a privileged settings window and a sandboxed
  content/plugin window need different surfaces.
- **Scope:**
  - Per-channel `scopes: ["settings", "editor"]`. Unscoped channels are in a default scope.
  - Generate one preload plus one `.d.ts` per scope.
  - The main side can optionally reject calls from windows outside the scope, via a registry of
    `webContents` id → scope.
- **Tests:** writer tests per scope, plus runtime rejection tests.
- **Depends on:** T16, T32
- **Delivered:**

### [ ] T34: Per-window scoped handlers (`webContents.ipc`)
- **Problem:** per-document windows must look up their state by `event.sender.id`. Electron supports
  handlers scoped to one `webContents`/frame.
- **Scope:**
  - Generate `bind<X>(webContents, handler)` registering on `webContents.ipc`.
  - Return a disposer, and auto-dispose on `destroyed`.
- **Tests:** runtime tests: scoped handler wins over global (per Electron's dispatch order),
  auto-dispose.
- **Depends on:** T15
- **Delivered:**

### [ ] T35: `getPathForFile` helper
- **Problem:** `File.path` was removed in Electron 32. Drag-and-drop apps must call
  `webUtils.getPathForFile` in the preload.
- **Scope:** a config flag adds `getPathForFile(file: File): string` to the exposed API (sandbox-safe).
- **Tests:** writer test, plus a runtime test with a mocked `webUtils`.
- **Depends on:** T32
- **Delivered:**

### [ ] T36: Service worker IPC (Electron ≥ 35, experimental)
- **Problem:** `ServiceWorkerMain.ipc` and `session.registerPreloadScript({ type: 'service-worker' })`
  are unsupported.
- **Scope:**
  - Directions `ServiceWorkerToMain` and `MainToServiceWorker`.
  - Note that `IpcMainServiceWorker` has no `off` (use `removeListener`) and its events have no
    `senderFrame` (sender validation uses `versionId`/`scope`).
  - Generate a SW preload.
- **Tests:** runtime tests with mocks.
- **Depends on:** T15, T16
- **Delivered:**

### [ ] T37: Custom serializers
- **Problem:** `Date`, `Map` and class instances lose fidelity or prototype across IPC.
- **Scope:**
  - Optional config pointing at a module exporting `serialize`/`deserialize` (superjson-compatible
    shape).
  - Applied symmetrically in generated main and preload code.
  - Off by default.
- **Tests:** runtime round-trip tests.
- **Depends on:** T18
- **Delivered:**

---

## Phase 4: Developer experience

### [ ] T38: Config file and CLI flags
- **Problem:**
  - Config can only live in `package.json`, and there are no CLI flags.
  - Output paths are fixed.
  - `projectUsesNodeNext` must be set by hand.
- **Scope:**
  - Support `autoipc.config.{json,ts,mjs}` (precedence: CLI > config file > package.json).
  - Flags `--cwd`, `--config`, `--out-main`, `--out-preload`, `--out-types`.
  - Auto-detect NodeNext from the nearest `tsconfig*.json` when unset.
  - Unknown config keys are errors.
- **Tests:** config resolution unit tests for each source and precedence.
- **Depends on:** T07
- **Delivered:**

### [ ] T39: `ipcgen --check`
- **Problem:** CI cannot detect stale generated files.
- **Scope:**
  - Render in memory and compare with the files on disk. Exit 1 with a list of stale files; write
    nothing.
  - Embed a schema hash in the notice header.
- **Tests:** e2e: fresh → 0, schema edited → 1, no writes in check mode.
- **Depends on:** T06, T38
- **Delivered:**

### [ ] T40: `ipcgen --watch`
- **Scope:**
  - Watch the schema file/dir (recursive) and the referenced type files.
  - Debounce, regenerate, and keep running on errors (print them).
- **Tests:** e2e with a temp dir: edit triggers regeneration; a syntax error does not kill the
  watcher.
- **Depends on:** T08, T38
- **Delivered:**

### [ ] T41: Programmatic API and Vite / electron-vite plugin
- **Problem:** no programmatic entry; `index.ts` exports only the schema DSL.
- **Scope:**
  - Export `generate(options)` and `check(options)` from a `automate-electron-ipc/api` subpath.
  - Add a Vite plugin at `automate-electron-ipc/vite` that runs on `buildStart` and regenerates on
    schema HMR.
  - Update `package.json` `exports`.
- **Tests:** API unit tests, plus a plugin test with a minimal Vite plugin-container mock.
- **Depends on:** T39, T40
- **Delivered:**

### [ ] T42: Diagnostics
- **Problem:**
  - Raw superstruct `StructError`s surface to users without file or position.
  - Typos in config keys (`listner`) are silently ignored.
- **Scope:**
  - All schema errors report `file:line:col` with a code frame from swc spans.
  - Unknown keys in channel configs are errors.
  - Multiple errors are collected and reported together.
- **Tests:** snapshot tests of error output for representative mistakes.
- **Depends on:** T08
- **Delivered:**

### [ ] T43: Generated file hygiene
- **Scope:**
  - The notice header names `ipcgen` and the schema path.
  - Add `/* eslint-disable */` and a Biome ignore directive.
  - Optional config `format: "biome" | "prettier" | false` runs the user's formatter if installed.
  - Generated code passes the repo's own Biome rules.
- **Tests:** writer tests; e2e runs Biome on the output.
- **Depends on:** T39
- **Delivered:**

### [ ] T44: Exported helper types
- **Problem:** users cannot type wrappers or hooks generically.
- **Scope:** generated `window.d.ts` (or a `types.ts`) exports `IpcApi`, `ChannelName`,
  `ChannelArgs<N>` and `ChannelResult<N>`. Derive them with mapped types over `typeof` the exported
  channel maps from T00 (`import type`), handling both signature forms, instead of emitting each
  type as text.
- **Tests:** e2e type-level tests (`expectTypeOf`).
- **Depends on:** T13
- **Delivered:**

### [-] T45: Generic DSL syntax
- **Dropped:** superseded by T00, whose main form is `verb<Sig>(config?)`, with
  `verb(config?) as Sig` as an alternative.

### [ ] T46: Mock generation for renderer tests
- **Problem:** renderer unit tests, Storybook and running the UI in a plain browser need a fake
  `window.ipc`.
- **Scope:**
  - Optional generated `mock.ts` exporting `createIpcMock(overrides?)`, a fully typed implementation
    whose functions are configurable stubs.
  - It can emit events to listeners: `mock.emit.onProgress(...)`.
  - Add `installIpcMock()` that assigns it to `window`.
- **Tests:** runtime tests of the generated mock, plus an e2e type-check.
- **Depends on:** T14, T44
- **Delivered:**

### [ ] T47: Framework hooks (optional output)
- **Scope:**
  - Config `hooks: "react" | "vue" | false` generates `useIpcEvent(name, cb)`, which subscribes and
    disposes on unmount, and `useIpcInvoke(name)`.
  - No framework dependency in the library itself.
- **Tests:** writer tests, plus an e2e type-check against `@types/react` / `vue` (dev deps).
- **Depends on:** T14, T44
- **Delivered:**

### [ ] T48: README rewrite
- **Scope:**
  - Full docs of every channel kind with its generated output.
  - Config reference and CLI flags.
  - tsconfig wiring.
  - An electron-vite end-to-end example.
  - Preload bundling and sandbox notes.
  - A security guide (sender validation, argument validation, scopes).
  - Migration notes from 0.2.x.
- **Tests:** none; verify the README examples via an e2e fixture that mirrors them.
- **Depends on:** all previous tasks
- **Delivered:**
