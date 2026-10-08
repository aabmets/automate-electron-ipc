# T27: Streaming results with cancellation

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

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
- **Delivered:**
