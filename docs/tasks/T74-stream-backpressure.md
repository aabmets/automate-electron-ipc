# T74: Backpressure for streams

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T27. The generator of a `stream` channel runs ahead of a page that reads slowly,
  and the chunks pile up in the memory of the page. A fast generator and a slow reader (a large export,
  a token stream into a heavy UI) can use unbounded memory, and nothing slows the producer.
- **Scope:**
  - Decide a flow-control scheme over the per-call port, such as a credit window: the page grants N
    chunks, the main process stops pulling from the generator at zero credits, and the page grants
    more as it reads. Keep the default behaviour fast, and the generated code sandbox-safe.
  - A `highWaterMark`-like option of `stream` (a non-negative integer or `Infinity`), with a default
    that keeps today's throughput for small chunks.
  - `cancel()` and the error paths of T27 must keep working while the producer is paused.
  - Found in T30: `streamUtility` has the same problem, with the generator in the utility process and
    all the streams of a channel sharing one port. The credits are per call ID there, and the pump in
    `utility.ts` is the producer to pause.
- **Tests:** runtime tests with a slow reader (the generator pauses at the limit and resumes), a reader
  that cancels while paused, and ordering.
- **Delivered:** 2026-10-09. Deviations and notes:
  - New option `highWaterMark` of `stream` and `streamUtility`: a non-negative integer literal or
    `Infinity` (parsed like `maxQueue`, validated by `validateCountLimit`; `StreamConfig` and a new
    `UtilityStreamConfig` in `types/index.d.ts`). The default is 1024 chunks, the unit is the chunk,
    whatever its size. No project-wide default in the `autoipc` config, as `timeoutMs` has; add it
    with the config work of T38 if it is wanted.
  - Scheme: a credit window over the port of the call. The producer starts with `limit = highWaterMark`,
    counts the chunks it sent, and does not call `iterator.next()` while `sent >= limit`. The page sends
    `{ type: 'credit', limit }` (the utility process gets `{ __ipc: 'credit', channel, id, limit }`),
    where `limit` is the total of chunks the page allows so far, so a repeated, late or lower message is
    harmless: only a higher number counts, and a non-number is ignored. The reader grants
    `consumed + max(highWaterMark, waiting reads)` once that is at least half a window beyond what it
    granted, so a fast reader costs one message per half window and the queue does not run dry. `0` is
    pull-based (a grant per waiting read), and `Infinity` sends no credit and never pauses.
  - Both ends take the window from the generated code, not from the wire: the producer from its own
    spec (`startStream` in `main.ts`, `brokerWindows` in `utility.ts`), the page from `openStream` and
    `openUtilityStream`. A page cannot lift the window of the producer by asking for one in the start
    message; it can only grant credit, which only costs its own memory.
  - A paused pump waits on a wake-up that cancel, port close, destroyed contents and credit all fire, so
    `cancel()` and the end paths work while paused. The generator is suspended at a `yield` then, so
    `return()` runs its `finally` at once. An error or the end of the generator is found by a pull, so
    it reaches the page once the page has granted that pull (always, for a page that keeps reading).
  - Shared reader (`createStreamReader`) now takes the window and a `grant` function, which returns
    `false` when the port is not there yet; `topUp()` repeats the grant when the port arrives or the
    start message is posted.
  - Tests: parser, validators, writer text, runtime tests of the generated main, preload and utility
    scripts (pause at the limit, resume on credit, ignored credits, per-call windows, cancel, close and
    destroy while paused, error after the pause, window 0 and `Infinity`, the default), real
    `MessageChannel` round trips with a slow reader, and real Electron scenarios (`stream` and
    `streamUtility` with a slow reader, a pull-based stream, a cancel while paused).
