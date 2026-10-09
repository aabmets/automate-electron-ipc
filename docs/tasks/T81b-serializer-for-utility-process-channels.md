# T81b: Serializer for utility process channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T37, split from T81. The channels of utility processes (`callUtility`,
  `notifyUtility`, `callMain`, `notifyMain`) and the channels between a page and a utility process over
  the brokered port (`invokeUtility`, `streamUtility`) carry their values with the structured clone
  algorithm, so a class instance loses its prototype there while it keeps it on an `invoke`.
- **Scope:**
  - Apply the serializer at both ends: the main process and the `utility.ts` file, and the page and
    `utility.ts` over the brokered port (arguments, results, chunks of a stream). The protocol of the
    peer is shared text in `utility-runtime.ts`, so it can serialize in `main.ts` and in `utility.ts`.
  - The `utility.ts` file runs in a utility process that may not have the same module resolution, so
    decide how it gets the module of the config, and say it in the README.
  - Failures: follow the rules of T37 and T81a (a call that is answered reports the error, a `send` that
    cannot be read is logged and dropped).
  - Update the README section on serializers.
- **Tests:** runtime round trips for each channel kind, and an e2e type-check; a real-Electron group.
- **Delivered:** 2026-10-09. Notes:
  - The shared peer code (`buildUtilityPeer(indents, serialized)`) does the work, so `main.ts` and
    `utility.ts` get the same text, and the channel bindings did not change. A call or a send posts
    `args` as a list of one value, `[encodeValue(channel, args)]`, and an `ok` envelope holds the
    serialized result. The serializer helpers moved from `main-bindings.ts` to `buildSerializerRuntime`
    in `utility-runtime.ts`, and `utility.ts` now exports its own `IpcSerializationError`.
  - `isSerializedSpec` covers `MainToUtility`, `UtilityToMain` and `RendererToUtility`. `main.ts` turns
    off `RendererToUtility` (it only brokers the port), `preload.ts` turns off the two others, and
    `utility.ts` serializes all three.
  - Module resolution of `utility.ts`: it imports the serializer module like `main.ts` does (a package
    name as it is, a path relative to the file) and the README says the child must be built with the
    same bundler setup as the main process. No separate config option.
  - Failures follow T37 and T81a: a call or a send that cannot be serialized rejects or throws an
    `IpcSerializationError`; a call that arrives unreadable, or whose result cannot be serialized, is
    answered with the error envelope (the caller gets an `IpcUtilityError` with the name and code of
    the serialization error); a `send` that cannot be read is logged and dropped without using up a
    `once` listener; a reply that cannot be read rejects the call. Streams: unreadable arguments or an
    unserializable chunk fail the stream in the child; a chunk the page cannot read fails the stream
    in the page and cancels it in the child.
  - The fixture `serializer-no-pages` had a `callMain` channel to stay serializer-free; it now has an
    `askWorker` channel, since only the service worker channels are left (T81c).
  - Tests: writer text tests (`tests/test_writer/serializer.test.ts`), mock-runtime round trips with an
    e2e type-check (`tests/test_e2e/serializerUtility.test.ts`, fixture `serializer-utility`), and a
    real-Electron group (`tests/test_electron/serializerUtility.test.ts`).
