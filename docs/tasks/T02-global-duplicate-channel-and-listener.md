# T02: Global duplicate channel and listener validation (B2)

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `validateChannelSpecs` runs per file, so duplicate channel names
  across files go undetected. The result is duplicate object keys in the output (TS error), and
  Electron throws because a second handler is registered.
- **Scope:** validate uniqueness across all parsed files after parsing. The error message names both
  files.
- **Tests:** unit test, plus an e2e regression test with two schema files defining the same channel.
- **Delivered:** 2026-10-08. `validateGlobalChannelSpecs` runs in `ipcAutomation` after all files are parsed (files sorted by path so the message is deterministic). Custom `listeners` cannot be declared in the new syntax, so the listener check only matters for the implicit `on<Name>` listeners.
