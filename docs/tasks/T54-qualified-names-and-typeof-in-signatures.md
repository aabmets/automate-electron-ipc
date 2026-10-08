# T54: Qualified names, `typeof` and destructuring in signatures

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review.
  - `k: Kind.A`, where `Kind` is a named import (such as an enum) or a local type/namespace, is
    treated as a namespace import. No import is generated ("Cannot find namespace 'Kind'").
  - `c: typeof config` is not recorded: `collectCustomTypes` only handles `TsTypeReference`, not
    `TsTypeQuery`. No import is generated ("Cannot find name 'config'").
  - In a destructured param such as `({ a: b }: X) => void`, the renamed binding `b` is recorded
    as a type name (`KeyValuePatternProperty` branch in `collectCustomTypes`).
- **Scope:** resolve the head of a qualified name against namespace imports, named imports and
  local types. Collect `typeof` query heads. Stop collecting destructuring bindings.
- **Tests:** parser and imports-generator unit tests, plus an e2e fixture that type-checks.
- **Delivered:**
