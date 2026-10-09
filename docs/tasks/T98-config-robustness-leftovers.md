# T98: Config values left after T88 and T92

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T88 and T92.
  - On a file system that ignores case, an output path such as `ipc/Main.ts` is the generated
    `ipc/main.ts`, and the run writes one over the other. T88 compares paths with their case.
  - The origin pattern of `allowedOrigins` accepts malformed ports such as `https://example.com:443x`.
  - A `package.json` that is not a JSON object, or a `config.autoipc` that is not an object, falls
    through to the superstruct validation of the config with a confusing message.
- **Scope:** detect whether the project's file system ignores case and compare the output paths
  accordingly; make the origin pattern refuse a port that is not a number; name the manifest in the
  error of a manifest or an `autoipc` entry of the wrong shape.
- **Tests:** unit tests in `tests/config.test.ts` and `tests/validators.test.ts`.
- **Delivered:**
