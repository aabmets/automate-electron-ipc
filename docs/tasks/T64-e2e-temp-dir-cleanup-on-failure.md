# T64: E2E fixtures leave temp dirs behind on failure

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T07. `runFixture` copies the fixture into a temp dir before running
  the generator. When the generator throws (as in the duplicate-channels and syntax-error tests),
  the test never receives the project handle, so the temp dir is never deleted.
- **Scope:** `runFixture` deletes its temp dir before rethrowing an error from the generator.
- **Tests:** a harness test that a failing fixture leaves no temp dir behind.
- **Delivered:**
