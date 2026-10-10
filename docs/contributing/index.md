# Contributing

This page describes how to build the library and run its tests.

## Development

```bash
bun install
bun run check                 # tsc and biome
bunx vitest run               # the whole suite
bun run test:electron         # only the tests that run in a real Electron
```

Most tests load the generated files against a fake `electron` module. The tests in
`tests/test_electron/` run them in the `electron` binary the repo depends on, in hidden windows with
`sandbox: true` and `contextIsolation: true`, so that `contextBridge`, `senderFrame`, `MessagePort`
transfer and the sandboxed preload script are the real ones. They need:

- **The Electron binary.** `bun install` does not run the postinstall script of `electron`, so run
  `node node_modules/electron/install.js` once.
- **A display.** On Linux without `$DISPLAY` the tests start Electron under `xvfb-run -a`, so install
  `xvfb` (`apt-get install xvfb`). macOS and Windows need nothing.
- **`ELECTRON_NO_SANDBOX=1`** where Chromium's sandbox helper cannot run, such as in a container as
  root (the tests add the flag by themselves for root) or on a CI image whose kernel forbids it. It
  turns off the helper only; the windows still use `sandbox: true`.

Without the binary or a display these tests are skipped, and `bunx vitest run` stays green. With
`REQUIRE_ELECTRON=1`, which CI sets, they fail instead, so a broken setup cannot pass unnoticed.
