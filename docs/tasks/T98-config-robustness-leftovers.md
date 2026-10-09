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
- **Tests:** unit tests in `tests/config.test.ts` and `tests/test_validators/`.
- **Delivered:** 2026-10-09. `utils.isCaseInsensitiveFileSystem(dir)` probes the file system without writing: it stats
  the nearest existing ancestor of the data dir and the same path with the case of its last name
  swapped, and compares `dev` and `ino`. When it reports true, `getResolvedConfig` compares the output
  paths lower-cased (generated files, the other output, the schema file, schema sources, the
  serializer module); the tests inject the probe. The probe covers the volume of `ipcDataDir` only,
  so an output path on another volume is compared by that rule too. The origin pattern takes a port of
  letters and digits and refuses one that is not a decimal number from 0 to 65535 with its own message;
  other stray characters stay "not an origin". `getConfigFromUserPackage` names the manifest when it, `config`
  or `config.autoipc` is not an object (`null` and arrays included, and falsy values such as `0` or `""`
  of `autoipc`, which fell back to defaults before).
