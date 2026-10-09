# T38: Config file and CLI flags

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

> **Split** (architect review, 2026-10-09) into the parts listed in the roadmap. Each part's file is
> the plan to build from; this file keeps the original scope for reference.

- **Problem:**
  - Config can only live in `package.json`, and there are no CLI flags.
  - Output paths are fixed.
  - `projectUsesNodeNext` must be set by hand.
- **Scope:**
  - Support `autoipc.config.{json,ts,mjs}` (precedence: CLI > config file > package.json).
  - Flags `--cwd`, `--config`, `--out-main`, `--out-preload`, `--out-types`.
  - Auto-detect NodeNext from the nearest `tsconfig*.json` when unset.
  - Unknown config keys are errors.
- **Tests:** config resolution unit tests for each source and precedence.
- **Delivered:**
