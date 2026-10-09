# T107: Split `preload-bindings.ts`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/writer/preload-bindings.ts` is 1486 lines, again one class
  (`PreloadBindingsWriter`). Two of its methods are near the limit alone: `getPortComponents` (~260
  lines) and `buildUtilityClientComponents` (~275 lines).
- **Scope:**
  - Split along the features: invoke, timeouts and serializer components; subscriptions; `ask` and
    error components; stream channel, reader and components; utility and brokered clients; port
    components. The two long methods need a seam inside.
  - Follow the composition pattern that T103 set, if it has landed; otherwise choose one by the
    skill and record it.
  - If one session cannot hold it, split it into `T107a`, `T107b` (see `CLAUDE.md`).
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:** 2026-10-09. `PreloadBindingsWriter` now composes eight modules, as T103 to T106 did
  for the main process: a `PreloadContext` (indents, config, `usesSerializer` and the bound helpers
  of `BaseWriter`) is passed to functions, and a function which reads only the indents takes
  `indents`. The modules: `preload-invoke.ts` (invoke channel, serializer and timeout components,
  and `buildChannel`), `preload-subscriptions.ts`, `preload-asks.ts` (ask channel, error and ask
  components), `preload-streams.ts` (channel, reader, components, `hasBrokeredStreams`),
  `preload-utility.ts` and `preload-utility-calls.ts` (the long `buildUtilityClientComponents`
  split into connection, calls and listener), `preload-ports.ts` and `preload-port-queue.ts` (the
  long `getPortComponents` split into the queue helpers and `createPortChannel`). Deviation:
  `groupChannel` now picks `buildAskChannel` or `buildSubscriptionChannel` itself, since
  `buildMainToRendererChannel` only forwarded `Unicast` specs to the ask builder. `preload-bindings.ts`
  is 251 lines and left the baseline, and the output of all 95 fixtures is byte-identical.
