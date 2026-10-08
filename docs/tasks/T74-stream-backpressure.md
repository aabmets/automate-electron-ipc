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
- **Delivered:**
