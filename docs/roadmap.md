# Roadmap and work tracker

Source: the feature-completeness audit of v0.2.6 (2026-10-08). It compared the library against the
official Electron docs (IPC tutorial, ipcMain/ipcRenderer, contextBridge, MessagePorts,
utilityProcess, security checklist, breaking changes up to v44).

The session protocol is in [`CLAUDE.md`](../CLAUDE.md). Each task's goal, scope, tests and
delivery note are in its own file under [`tasks/`](./tasks/), linked below.

- One task = one commit = one session.
- Status: `[ ]` todo, `[x]` delivered, `[-]` dropped (kept so task IDs stay stable).
- Status and dependencies are kept only in this roadmap. Update it in the same commit that
  delivers, drops, splits or adds a task (see `CLAUDE.md`, step 6).
- **Decision needed** marks a task with an open question for the user.
- `Bn` refers to the audit's confirmed bug list.

**Progress:** 102 delivered, 23 remaining, 1 dropped.

## Phase 0: Declaration syntax and test infrastructure

- [x] [T00: New channel declaration syntax: a `defineChannels` map with verb helpers](./tasks/T00-new-channel-declaration-syntax.md) · depends on: none
- [x] [T01: E2E harness, and fix schema-dir crash on Node (B1)](./tasks/T01-e2e-harness-and-fix-schema.md) · depends on: T00

## Phase 1: Bug fixes

- [x] [T02: Global duplicate channel and listener validation (B2)](./tasks/T02-global-duplicate-channel-and-listener.md) · depends on: T01
- [x] [T03: Custom types from value imports are dropped (B3)](./tasks/T03-custom-types-from-value-imports.md) · depends on: T01
- [x] [T04: Rest parameters lose their spread in generated call sites (B4)](./tasks/T04-rest-parameters-lose-their-spread.md) · depends on: T01
- [x] [T05: Wrong generated types (B6, B7)](./tasks/T05-wrong-generated-types.md) · depends on: T01
- [x] [T06: Deterministic output ordering (B8)](./tasks/T06-deterministic-output-ordering.md) · depends on: T01
- [x] [T07: Correct project root resolution (monorepos)](./tasks/T07-correct-project-root-resolution.md) · depends on: T01
- [x] [T08: Schema file filtering, and surfacing parse errors](./tasks/T08-schema-file-filtering-and-surfacing.md) · depends on: T01
- [x] [T09: Type-definition edge cases](./tasks/T09-type-definition-edge-cases.md) · depends on: T01
- [x] [T10: Stale metadata and packaging dependencies (B10)](./tasks/T10-stale-metadata-and-packaging-dependencies.md) · depends on: none
- [x] [T11: CI on Node, plus e2e type-check job](./tasks/T11-ci-on-node-plus-e2e.md) · depends on: T01
- [x] [T12: Redesign `trigger` (B5)](./tasks/T12-redesign-trigger.md) · depends on: T04
- [x] [T49: Repeated use of a namespace import generates a bogus import](./tasks/T49-repeated-namespace-type-imports.md) · depends on: T03
- [x] [T50: E2E type-check must cover `window.d.ts`](./tasks/T50-e2e-typecheck-covers-window-dts.md) · depends on: T01
- [x] [T51: The empty `window.d.ts` is invalid](./tasks/T51-empty-window-dts-is-invalid.md) · depends on: T50
- [x] [T52: A schema with only `port` channels generates invalid code](./tasks/T52-port-only-schema-generates-invalid-code.md) · depends on: T50
- [x] [T53: Type names that collide across schema files](./tasks/T53-cross-file-type-name-collisions.md) · depends on: T50
- [x] [T54: Qualified names, `typeof` and destructuring in signatures](./tasks/T54-qualified-names-and-typeof-in-signatures.md) · depends on: T50
- [x] [T55: Import paths with dots in the file name are truncated](./tasks/T55-import-paths-with-dotted-file-names.md) · depends on: T50
- [x] [T56: Async return type detection is a prefix match](./tasks/T56-async-return-type-detection.md) · depends on: T05
- [x] [T57: Parameter names clash with generated names; event injection](./tasks/T57-generated-wrapper-parameter-handling.md) · depends on: T04, T05
- [x] [T58: Config and export-form robustness](./tasks/T58-config-and-export-form-robustness.md) · depends on: T01
- [x] [T59: Schema type names that clash with generated names](./tasks/T59-schema-types-clashing-with-generated-names.md) · depends on: T53
- [x] [T60: Schema types that shadow built-in globals](./tasks/T60-schema-types-shadowing-globals.md) · depends on: T09
- [x] [T61: Types exported by `export { X }` or `export default class`](./tasks/T61-export-specifiers-and-default-classes.md) · depends on: T09
- [x] [T62: `typeof` of a value declared in the schema file](./tasks/T62-typeof-schema-local-values.md) · depends on: T54
- [x] [T63: Errors thrown by `bind<X>` providers](./tasks/T63-bind-provider-errors.md) · depends on: T12
- [x] [T64: E2E fixtures leave temp dirs behind on failure](./tasks/T64-e2e-temp-dir-cleanup-on-failure.md) · depends on: T50
- [x] [T65: Leading blank line and unused imports in generated files](./tasks/T65-leading-blank-line-and-unused-imports.md) · depends on: T52
- [x] [T66: swc spans are UTF-8 byte offsets, so non-ASCII source corrupts the output](./tasks/T66-swc-spans-are-utf8-byte-offsets.md) · depends on: T01
- [x] [T67: Locale-dependent sorting remains in the writers and the global validation](./tasks/T67-locale-dependent-sorting-remains.md) · depends on: T06
- [x] [T68: The suite fails under Bun; order-dependent and under-restored tests](./tasks/T68-suite-fails-under-bun-and-order-dependent-tests.md) · depends on: T07, T11
- [x] [T69: Signature edge cases that produce wrong or confusing generated code](./tasks/T69-signature-edge-cases-in-generated-code.md) · depends on: T53, T57
- [x] [T70: Test harness and fixture gaps](./tasks/T70-test-harness-gaps.md) · depends on: T50
- [x] [T71: Syntax error positions and the success report path](./tasks/T71-diagnostics-positions-and-paths.md) · depends on: T08
- [x] [T76: Port channels never pair while `isLoading()` is true](./tasks/T76-port-pairing-waits-on-isloading.md) · depends on: T75
- [x] [T77: `ask` on a destroyed `BrowserWindow` throws a TypeError](./tasks/T77-ask-on-destroyed-browser-window.md) · depends on: T75
- [x] [T78: `connect` leaves an entry behind when the second window is destroyed](./tasks/T78-connect-leaks-first-end-on-destroyed-window.md) · depends on: T76
- [x] [T82: A synchronous error of the preload script loses its fields across `contextBridge`](./tasks/T82-synchronous-errors-lose-fields-across-contextbridge.md) · depends on: T81a
- [x] [T84: An `ask` never settles when the asked page reloads, navigates or crashed](./tasks/T84-ask-hangs-when-the-page-goes-away.md) · depends on: T77
- [x] [T85: The page-load watch takes error pages and aborted navigations for loads](./tasks/T85-page-load-watch-error-pages-and-aborted-navigations.md) · depends on: T76, T30
- [x] [T86: Calls to a utility process that exited before the bindings saw it hang forever](./tasks/T86-calls-to-a-utility-child-that-already-exited.md) · depends on: T30
- [x] [T87: Listeners that grow with each call, stream, connection or registration](./tasks/T87-listeners-that-grow-per-call-or-registration.md) · depends on: T84, T85
- [x] [T88: Config values which are accepted, but break the output](./tasks/T88-config-values-that-break-the-output.md) · depends on: T29, T36
- [x] [T89: Import paths of script extensions, JSON modules and import types](./tasks/T89-import-paths-of-script-extensions-and-import-types.md) · depends on: T55
- [x] [T90: Decorators and import-equals in schema files](./tasks/T90-schema-syntax-decorators-and-import-equals.md) · depends on: T54
- [x] [T91: A Promise nested in a result is not reported](./tasks/T91-promise-nested-in-a-result.md) · depends on: T19
- [x] [T92: Diagnostics which name the wrong path, or none](./tasks/T92-diagnostics-that-name-the-wrong-path.md) · depends on: T71
- [x] [T93: Review of the source and the tests](./tasks/T93-review-of-the-source-and-the-tests.md) · depends on: T83
- [x] [T94: The preload adds one `ipcRenderer` listener per subscription](./tasks/T94-preload-listeners-per-subscription.md) · depends on: T87
- [x] [T95: Edge cases of the page-load watch left after T85](./tasks/T95-page-load-watch-edge-cases.md) · depends on: T85, T87
- [x] [T96: `Awaited`, `PromiseLike` and a sync result of `Promise<X> | X`](./tasks/T96-clone-check-awaited-and-promise-unions.md) · depends on: T91
- [x] [T97: Import paths and schema syntax left after T89 and T90](./tasks/T97-import-path-and-schema-syntax-leftovers.md) · depends on: T89, T90
- [x] [T98: Config values left after T88 and T92](./tasks/T98-config-robustness-leftovers.md) · depends on: T88, T92
- [x] [T99: The README denies options that utility channels have](./tasks/T99-readme-options-of-utility-channels.md) · depends on: T79, T86
- [x] [T100: Two blank lines in a row between components of the generated `preload.ts`](./tasks/T100-double-blank-lines-in-generated-preload.md) · depends on: T94
- [x] [T101: Directory imports through `package.json` and path mappings](./tasks/T101-directory-imports-through-package-json-and-paths.md) · depends on: T97

## Phase 2: Core API, listener lifecycle and security

- [x] [T13: Naming of generated API members](./tasks/T13-naming-of-generated-api-members.md) · depends on: T05
- [x] [T14: Renderer listener disposers and `once`](./tasks/T14-renderer-listener-disposers-and-once.md) · depends on: T13
- [x] [T15: Main-process listener and handler disposers and `handleOnce`](./tasks/T15-main-process-listener-and-handler.md) · depends on: T13
- [x] [T16: Sender validation (Electron security checklist #17)](./tasks/T16-sender-validation.md) · depends on: T15
- [x] [T17: Runtime argument validation (Standard Schema)](./tasks/T17-runtime-argument-validation.md) · depends on: T16
- [x] [T18: Typed error envelope for Unicast](./tasks/T18-typed-error-envelope-for-unicast.md) · depends on: T15
- [x] [T19: Structured-clone awareness in signatures](./tasks/T19-structured-clone-awareness-in-signatures.md) · depends on: T08
- [x] [T20: Channel name prefix / namespacing](./tasks/T20-channel-name-prefix-namespacing.md) · depends on: T13
- [x] [T72: Channel name rules left over from the listener names](./tasks/T72-channel-name-rules-from-listener-names.md) · depends on: T13

## Phase 3: Missing Electron features

- [x] [T21: Main → renderer targets and broadcast-to-all](./tasks/T21-main-renderer-targets-and-broadcast.md) · depends on: T12
- [x] [T22: Frame-targeted sends](./tasks/T22-frame-targeted-sends.md) · depends on: T21
- [x] [T23: `ask` channels (main asks a renderer and awaits the answer)](./tasks/T23-ask-channels.md) · depends on: T18, T21
- [x] [T24: Robust port lifecycle (B9)](./tasks/T24-robust-port-lifecycle.md) · depends on: T14
- [x] [T25: One-to-many port topologies](./tasks/T25-one-to-many-port-topologies.md) · depends on: T24
- [x] [T26: Main ↔ renderer port channels](./tasks/T26-main-renderer-port-channels.md) · depends on: T24
- [x] [T73: Bounded send queues of port channels](./tasks/T73-bounded-port-queues.md) · depends on: T26
- [x] [T27: Streaming results with cancellation](./tasks/T27-streaming-results-with-cancellation.md) · depends on: T18, T24
- [x] [T75: Real-Electron integration tests](./tasks/T75-real-electron-integration-tests.md) · depends on: T11, T27, T73
- [x] [T28: Invoke timeouts](./tasks/T28-invoke-timeouts.md) · depends on: T18
- [x] [T29: utilityProcess channels](./tasks/T29-utilityprocess-channels.md) · depends on: T18
- [x] [T30: Renderer ↔ utility process via a brokered port](./tasks/T30-renderer-utility-process-via.md) · depends on: T26, T29
- [x] [T31: Configurable exposure key and isolated worlds](./tasks/T31-configurable-exposure-key-and-isolated.md) · depends on: T13
- [x] [T32: Composable preload output](./tasks/T32-composable-preload-output.md) · depends on: T31
- [x] [T33: Per-window API scopes (least privilege)](./tasks/T33-per-window-api-scopes.md) · depends on: T16, T32
- [x] [T34: Per-window scoped handlers (`webContents.ipc`)](./tasks/T34-per-window-scoped-handlers.md) · depends on: T15
- [x] [T35: `getPathForFile` helper](./tasks/T35-getpathforfile-helper.md) · depends on: T32
- [x] [T36: Service worker IPC (Electron ≥ 35, experimental)](./tasks/T36-service-worker-ipc.md) · depends on: T15, T16
- [x] [T37: Custom serializers](./tasks/T37-custom-serializers.md) · depends on: T18
- [x] [T74: Backpressure for streams](./tasks/T74-stream-backpressure.md) · depends on: T27
- [x] [T79: Timeouts for utility process calls](./tasks/T79-utility-call-timeouts.md) · depends on: T29, T28, T30
- [x] [T80: Validation and timeouts for service worker calls](./tasks/T80-worker-call-validation-and-timeouts.md) · depends on: T36, T17, T28
- [x] [T81a: Serializer for port channels](./tasks/T81a-serializer-for-port-channels.md) · depends on: T37, T26
- [x] [T81b: Serializer for utility process channels](./tasks/T81b-serializer-for-utility-process-channels.md) · depends on: T81a, T30, T79
- [x] [T81c: Serializer for service worker channels](./tasks/T81c-serializer-for-service-worker-channels.md) · depends on: T81a, T36, T80
- [x] [T83: Real-Electron coverage of the features that only fakes tested](./tasks/T83-real-electron-coverage-gaps.md) · depends on: T75

## Phase 3b: Module structure

Runs before Phase 4 on purpose: a task is picked by its place in this file, and the features of
Phase 4 would otherwise grow the big files first. `size-baseline.json` lists the files that these
tasks work down, and `bun run check` fails when one of them grows.

- [x] [T102: The file size gate and the project skills](./tasks/T102-file-size-gate-and-project-skills.md) · depends on: none
- [x] [T103: Split `main-bindings.ts`, part 1: imports, support, scopes and validation](./tasks/T103-main-bindings-part-1-support-scopes-validation.md) · depends on: T102
- [x] [T104: Split `main-bindings.ts`, part 2: channels, `ask` and streams](./tasks/T104-main-bindings-part-2-channels-and-asks.md) · depends on: T103
- [x] [T105: Split `main-bindings.ts`, part 3: ports, utility and brokered channels](./tasks/T105-main-bindings-part-3-ports-utility-and-broker.md) · depends on: T104
- [x] [T106: Split `main-bindings.ts`, part 4: service workers, and the final shape](./tasks/T106-main-bindings-part-4-service-workers.md) · depends on: T105
- [x] [T107: Split `preload-bindings.ts`](./tasks/T107-preload-bindings-split.md) · depends on: T102
- [x] [T108: Split `parser.ts`, part 1: AST helpers, signatures, clone check and diagnostics](./tasks/T108-parser-part-1-ast-clone-check-and-diagnostics.md) · depends on: T102
- [x] [T109: Split `parser.ts`, part 2: channel maps, imports, definitions and `parseSpecs`](./tasks/T109-parser-part-2-channel-maps-and-specs.md) · depends on: T108
- [x] [T110: Split `validators.ts`](./tasks/T110-validators-split.md) · depends on: T102
- [ ] [T111: Split the remaining writer modules](./tasks/T111-remaining-writer-modules-split.md) · depends on: T102
- [ ] [T112: Split `types/index.d.ts` and `types/internal.d.ts`](./tasks/T112-types-split.md) · depends on: T102 · **Decision needed**
- [ ] [T113: Split `tests/test_writer/main-bindings.test.ts`](./tasks/T113-main-bindings-tests-split.md) · depends on: T102
- [ ] [T114: Split the writer tests, part 1: preload, imports and base writer](./tasks/T114-writer-tests-split-a.md) · depends on: T102
- [ ] [T115: Split the writer tests, part 2: renderer types, service workers, serializer, utility](./tasks/T115-writer-tests-split-b.md) · depends on: T102
- [ ] [T116: Split the parser tests](./tasks/T116-parser-tests-split.md) · depends on: T102
- [ ] [T117: Split `tests/validators.test.ts`](./tasks/T117-validators-tests-split.md) · depends on: T102
- [ ] [T118: Split the root tests and the test utilities](./tasks/T118-root-tests-and-test-utils-split.md) · depends on: T102
- [ ] [T119: Split the real-Electron tests](./tasks/T119-electron-tests-split.md) · depends on: T102
- [ ] [T120: Split the e2e tests, part 1: ports](./tasks/T120-e2e-port-tests-split.md) · depends on: T102
- [ ] [T121: Split the e2e tests, part 2: streams, asks and runtime](./tasks/T121-e2e-stream-ask-runtime-tests-split.md) · depends on: T102
- [ ] [T122: Split the e2e tests, part 3: automation, utility, scopes and handlers](./tasks/T122-e2e-automation-utility-scopes-tests-split.md) · depends on: T102
- [ ] [T123: Split the e2e tests, part 4: service workers, serializers and the rest](./tasks/T123-e2e-service-worker-serializer-tests-split.md) · depends on: T102

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
