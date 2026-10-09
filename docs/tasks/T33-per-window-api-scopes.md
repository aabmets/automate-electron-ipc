# T33: Per-window API scopes (least privilege)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** every window gets every channel. Apps with a privileged settings window and a sandboxed
  content/plugin window need different surfaces.
- **Scope:**
  - Per-channel `scopes: ["settings", "editor"]`. Unscoped channels are in a default scope.
  - Generate one preload plus one `.d.ts` per scope.
  - The main side rejects calls to a scoped channel from windows outside its scope, via a registry
    of `webContents` id → scope that windows using a scope must be registered in. Unscoped channels
    stay open to all windows.
- **Tests:** writer tests per scope, plus runtime rejection tests.
- **Delivered:** 2026-10-09. The option `scopes` (lower case words joined by dashes, `default` reserved) is accepted by `invoke`, `send`, `emit`, `ask`, `stream`, `port`, `mainPort`, `invokeUtility` and `streamUtility`. The API of a scope is its own channels plus the unscoped ones, which every scope has since they are open to all windows. The usual `preload.ts` and `window.d.ts` hold the unscoped channels only (so a schema without scopes generates what it did), and each scope gets `preload.<scope>.ts` and `window.<scope>.d.ts` next to them, from writers that are given the filtered schema (`src/scopes.ts`). `main.ts` exports `IpcScope` and `registerScope(window | view | contents, scope)`, which returns a disposer, replaces an earlier registration, is removed when the contents are destroyed and throws for an undeclared scope. The registry is keyed by `webContents.id`. `isSenderAllowed` gets a `scopes` argument that is checked before `allowedOrigins` and `validateSender`, so contents outside the scopes of an `invoke`, `send` or `stream` channel get an `IpcForbiddenError` (or are dropped) and `onRejected` is called. Deviations: (1) only the calls of a page (`invoke`, `send`, `stream`) are guarded in the main process; for `emit`, `ask`, port and utility channels `scopes` decides the API of the page only, since the main process picks the window; (2) every `window*.d.ts` declares the same global, so a renderer project includes one of them (said in the file and in the README); (3) the types `AskConfig` and `UtilityPortConfig` lost their empty index signature, so a wrong option is now error TS2353 instead of TS2322. Covered by parser, validator, writer, automation, runtime (mocked events), e2e type-check per scope (fixture `scoped-windows`) and real-Electron tests (fixture `electron-scopes`, where a window can use the preload script of a scope it is not registered in). Follow-up added to T43: the files of a scope that was removed from the schema stay behind.
