# T75: Real-Electron integration tests

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** nothing runs the generated bindings inside Electron. The runtime tests load the
  generated files against a fake `electron` module and, for ports, Node's `MessageChannel`. The
  delivery notes of T24, T25 and T26 say so. Fakes have already been wrong: `contextBridge` strips
  the fields of a thrown `Error`, which changed the design of T18, and that was found only by
  running Electron by hand. Port transfer, `senderFrame`, the sandboxed preload and the real
  `getAllWebContents` can differ from a fake the same way.
- **Scope:**
  - **Harness** (`tests/test_electron/`, helpers in `tests/utils/`):
    - Runs the generated `main.ts` and `preload.ts` of a fixture in the `electron` binary that the
      repo depends on (version pinned in `package.json`). The files are turned into CommonJS with
      swc, as the runtime tests do, and need no bundler: the generated preload only requires
      `electron`, which a sandboxed preload may do.
    - One Electron process per fixture group, not per test. It opens hidden windows with
      `sandbox: true` and `contextIsolation: true`, runs a scenario script in the main process
      and in the pages, and prints the result as one JSON line, which the test parses and asserts
      on. A scenario that does not finish in time fails the test, and the process is killed.
    - Starts under `xvfb-run -a` when Linux has no `DISPLAY`. The chrome sandbox helper is turned
      off with `--no-sandbox` where the container needs it, but never the sandbox of the
      renderers.
    - The tests skip when the binary or a display is missing, so `bunx vitest run` stays green on a
      machine without them. With `REQUIRE_ELECTRON=1`, which CI sets, they fail instead of skipping.
    - Cleans up its temp dirs and processes on every outcome, including a failed scenario.
  - **Scenarios,** each against real Electron:
    - `invoke`: a value, a thrown custom error with `code` and `data` (the object reaches the page
      with its fields and is not an `Error`), a call with no handler, `handleOnce`, and a handler
      that is replaced.
    - `send` and `emit`: arguments with rest and optional parameters; `send` to a window, to a
      `WebContentsView` and to a `WebContents`; `broadcast` and `broadcastTo` with a window that
      was destroyed; a `bind` trigger.
    - Sender validation: `allowedOrigins` and `validateSender` with a real `senderFrame`, from the
      main frame and from an iframe of another origin.
    - `validate`: a valid and an invalid call.
    - `ask`: an answer, a timeout, a destroyed contents and two concurrent requests.
    - `port`: two windows connected, a message each way, a reload of one page, and `close()`.
    - `mainPort`: a round trip, a reload, and a queue that is bounded by `maxQueue`.
    - `stream`: all chunks, an abort from the page, and an error in the middle.
    - The channel prefix: a custom `channelPrefix` reaches both sides.
  - **CI:** a job (or a step of the existing job) installs the Electron binary
    (`node node_modules/electron/install.js`, since `bun install` does not run its postinstall),
    installs `xvfb`, and runs the suite with `REQUIRE_ELECTRON=1`. It runs on Node 24 only.
  - **Docs:** `CLAUDE.md` and the README of the repo tell a contributor how to run it
    (`bun run test:electron`), and which tests need a display.
  - A scenario that finds a bug in the generated code is not fixed here: it is recorded as a new
    task, and the scenario is added as `it.fails` with a reference to that task.
- **Tests:** the scenarios above are the tests. Besides, a harness test that a scenario that
  hangs is killed and fails, that the process and temp dir are gone afterwards, and that the suite
  skips without the binary and fails with `REQUIRE_ELECTRON=1`.
- **Delivered:**
