# T58: Config and export-form robustness

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review.
  - `export default defineChannels({...}) satisfies X` (or `as const`) is rejected as "not
    exported", because only parentheses are unwrapped around the call.
  - `automation.ts` falls back to `"src/ipc"` for `relativePath`, but the default `ipcDataDir` is
    `"src/autoipc"`.
  - `codeIndent` accepts non-integers such as `2.5`, which are silently rounded down.
- **Scope:** unwrap `satisfies`, `as` and non-null wrappers around the `defineChannels` call. Remove
  the stale fallback. Require an integer `codeIndent`.
- **Tests:** parser, automation and validator unit tests.
- **Delivered:**
