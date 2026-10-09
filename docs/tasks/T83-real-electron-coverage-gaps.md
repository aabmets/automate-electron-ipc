# T83: Real-Electron coverage of the features that only fakes tested

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in a review of the test suite (2026-10-09). Several delivered features ran only
  against fakes of Electron, or the `MessageChannel` of Node, and never in the `electron` binary:
  one-to-many port topologies (T25 says "nothing was run in Electron"), invoke timeouts (T28), the
  exposure options `exposeAs` and `isolatedWorldId` (T31), the composed preload output with
  `autoExpose: false` (T32), and the listener disposers of the page and of the main process
  (T14, T15).
- **Scope:** real-Electron scenarios for each, with the existing fixtures where they fit, and a new
  `electron-compose` fixture whose `preload.app.ts` composes the generated preload script the way an
  application would.
- **Tests:**
  - `tests/test_electron/topologies.test.ts`: a hub with three peers, a connection per peer, a send to
    one connection and to the channel, a close from the page and from main that ends one connection
    only, a closed connection that stays closed when both pages reload, and a reloaded peer that is
    paired on the connection the hub already has.
  - `tests/test_electron/timeouts.test.ts`: the timeout of a channel and of the config, `timeoutMs: 0`,
    an answer in time, the error of the handler, and a late answer that is dropped without an error.
  - `tests/test_electron/exposure.test.ts`: `exposeAs`, `isolatedWorldId` (the API exists in that world
    only) and `autoExpose: false` with a preload script of the app that calls `expose` twice and uses
    `api` itself.
  - `tests/test_electron/core.test.ts`: the disposers of `on` and `once` in the page and in main.
- **Delivered:** 2026-10-09. All scenarios passed at once; no bug was found in these features. The
  composed preload is loaded through the `scope` option of `ctx.open`, which picks
  `preload.<scope>.js`, since a sandboxed preload must be one file and the runner inlines `./preload`
  only into files named `preload*.ts`.
