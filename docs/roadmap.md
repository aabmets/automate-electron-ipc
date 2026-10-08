# Roadmap and work tracker

Source: the feature-completeness audit of v0.2.6 (2026-10-08). It compared the library against the
official Electron docs (IPC tutorial, ipcMain/ipcRenderer, contextBridge, MessagePorts,
utilityProcess, security checklist, breaking changes up to v44).

The session protocol is in [`CLAUDE.md`](../CLAUDE.md). Each task's goal, scope, tests and
delivery note are in its own file under [`tasks/`](./tasks/), linked below.

- One task = one commit = one session.
- Status: `[ ]` todo, `[x]` delivered, `[-]` dropped (kept so task IDs stay stable).
- Status and dependencies are kept only in this roadmap. Update it in the same commit that
  delivers, drops, splits or adds a task (see `CLAUDE.md`, step 5).
- **Decision needed** marks a task with an open question for the user.
- `Bn` refers to the audit's confirmed bug list.

**Progress:** 0 delivered, 48 remaining, 1 dropped.

## Phase 0: Declaration syntax and test infrastructure

- [ ] [T00: New channel declaration syntax: a `defineChannels` map with verb helpers](./tasks/T00-new-channel-declaration-syntax.md) · depends on: none
- [ ] [T01: E2E harness, and fix schema-dir crash on Node (B1)](./tasks/T01-e2e-harness-and-fix-schema.md) · depends on: T00

## Phase 1: Bug fixes

- [ ] [T02: Global duplicate channel and listener validation (B2)](./tasks/T02-global-duplicate-channel-and-listener.md) · depends on: T01
- [ ] [T03: Custom types from value imports are dropped (B3)](./tasks/T03-custom-types-from-value-imports.md) · depends on: T01
- [ ] [T04: Rest parameters lose their spread in generated call sites (B4)](./tasks/T04-rest-parameters-lose-their-spread.md) · depends on: T01
- [ ] [T05: Wrong generated types (B6, B7)](./tasks/T05-wrong-generated-types.md) · depends on: T01
- [ ] [T06: Deterministic output ordering (B8)](./tasks/T06-deterministic-output-ordering.md) · depends on: T01
- [ ] [T07: Correct project root resolution (monorepos)](./tasks/T07-correct-project-root-resolution.md) · depends on: T01
- [ ] [T08: Schema file filtering, and surfacing parse errors](./tasks/T08-schema-file-filtering-and-surfacing.md) · depends on: T01
- [ ] [T09: Type-definition edge cases](./tasks/T09-type-definition-edge-cases.md) · depends on: T01
- [ ] [T10: Stale metadata and packaging dependencies (B10)](./tasks/T10-stale-metadata-and-packaging-dependencies.md) · depends on: none
- [ ] [T11: CI on Node, plus e2e type-check job](./tasks/T11-ci-on-node-plus-e2e.md) · depends on: T01
- [ ] [T12: Redesign `trigger` (B5)](./tasks/T12-redesign-trigger.md) · depends on: T04

## Phase 2: Core API, listener lifecycle and security

- [ ] [T13: Naming of generated API members](./tasks/T13-naming-of-generated-api-members.md) · depends on: T05 · **Decision needed**
- [ ] [T14: Renderer listener disposers and `once`](./tasks/T14-renderer-listener-disposers-and-once.md) · depends on: T13
- [ ] [T15: Main-process listener and handler disposers and `handleOnce`](./tasks/T15-main-process-listener-and-handler.md) · depends on: T13
- [ ] [T16: Sender validation (Electron security checklist #17)](./tasks/T16-sender-validation.md) · depends on: T15
- [ ] [T17: Runtime argument validation (Standard Schema)](./tasks/T17-runtime-argument-validation.md) · depends on: T16
- [ ] [T18: Typed error envelope for Unicast](./tasks/T18-typed-error-envelope-for-unicast.md) · depends on: T15
- [ ] [T19: Structured-clone awareness in signatures](./tasks/T19-structured-clone-awareness-in-signatures.md) · depends on: T08
- [ ] [T20: Channel name prefix / namespacing](./tasks/T20-channel-name-prefix-namespacing.md) · depends on: T13

## Phase 3: Missing Electron features

- [ ] [T21: Main → renderer targets and broadcast-to-all](./tasks/T21-main-renderer-targets-and-broadcast.md) · depends on: T12
- [ ] [T22: Frame-targeted sends](./tasks/T22-frame-targeted-sends.md) · depends on: T21
- [ ] [T23: `ask` channels (main asks a renderer and awaits the answer)](./tasks/T23-ask-channels.md) · depends on: T18, T21
- [ ] [T24: Robust port lifecycle (B9)](./tasks/T24-robust-port-lifecycle.md) · depends on: T14
- [ ] [T25: One-to-many port topologies](./tasks/T25-one-to-many-port-topologies.md) · depends on: T24
- [ ] [T26: Main ↔ renderer port channels](./tasks/T26-main-renderer-port-channels.md) · depends on: T24
- [ ] [T27: Streaming results with cancellation](./tasks/T27-streaming-results-with-cancellation.md) · depends on: T18, T24
- [ ] [T28: Invoke timeouts](./tasks/T28-invoke-timeouts.md) · depends on: T18
- [ ] [T29: utilityProcess channels](./tasks/T29-utilityprocess-channels.md) · depends on: T18
- [ ] [T30: Renderer ↔ utility process via a brokered port](./tasks/T30-renderer-utility-process-via.md) · depends on: T26, T29
- [ ] [T31: Configurable exposure key and isolated worlds](./tasks/T31-configurable-exposure-key-and-isolated.md) · depends on: T13
- [ ] [T32: Composable preload output](./tasks/T32-composable-preload-output.md) · depends on: T31
- [ ] [T33: Per-window API scopes (least privilege)](./tasks/T33-per-window-api-scopes.md) · depends on: T16, T32
- [ ] [T34: Per-window scoped handlers (`webContents.ipc`)](./tasks/T34-per-window-scoped-handlers.md) · depends on: T15
- [ ] [T35: `getPathForFile` helper](./tasks/T35-getpathforfile-helper.md) · depends on: T32
- [ ] [T36: Service worker IPC (Electron ≥ 35, experimental)](./tasks/T36-service-worker-ipc.md) · depends on: T15, T16
- [ ] [T37: Custom serializers](./tasks/T37-custom-serializers.md) · depends on: T18

## Phase 4: Developer experience

- [ ] [T38: Config file and CLI flags](./tasks/T38-config-file-and-cli-flags.md) · depends on: T07
- [ ] [T39: `ipcgen --check`](./tasks/T39-ipcgen-check.md) · depends on: T06, T38
- [ ] [T40: `ipcgen --watch`](./tasks/T40-ipcgen-watch.md) · depends on: T08, T38
- [ ] [T41: Programmatic API and Vite / electron-vite plugin](./tasks/T41-programmatic-api-and-vite-electron.md) · depends on: T39, T40
- [ ] [T42: Diagnostics](./tasks/T42-diagnostics.md) · depends on: T08
- [ ] [T43: Generated file hygiene](./tasks/T43-generated-file-hygiene.md) · depends on: T39
- [ ] [T44: Exported helper types](./tasks/T44-exported-helper-types.md) · depends on: T13
- [-] [T45: Generic DSL syntax](./tasks/T45-generic-dsl-syntax.md)
- [ ] [T46: Mock generation for renderer tests](./tasks/T46-mock-generation-for-renderer-tests.md) · depends on: T14, T44
- [ ] [T47: Framework hooks (optional output)](./tasks/T47-framework-hooks.md) · depends on: T14, T44
- [ ] [T48: README rewrite](./tasks/T48-readme-rewrite.md) · depends on: all previous tasks
