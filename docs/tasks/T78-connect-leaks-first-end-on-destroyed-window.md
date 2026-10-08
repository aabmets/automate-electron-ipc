# T78: `connect` leaves an entry behind when the second window is destroyed

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T77. `connectPorts` in `main.ts` registers the two ends of a
  `port` connection one after the other:
  `portEnds.set(end.key, { contents: end.win.webContents, close })`. If `winB` is destroyed,
  reading its `webContents` throws a `TypeError` in the second iteration, after the first end
  (`winA`) is already in the `portEnds` registry. `connect` throws, the caller never gets the
  handle, and the entry stays for the life of the process.
  - It keeps `close`, which refers to both windows and to the page-load watches, and the
    `WebContents` of `winA`, from being collected.
  - It also answers a later `<channel>:disconnect` from `winA`'s page that carries its key
    (`<id>:a`): the handler runs `close()` for a connection that was never returned.
  - Nothing removes it, since `winA` has no `closed` listener yet.
- **Scope:**
  - Make `connect` all-or-nothing: resolve the `webContents` of both windows before anything is
    registered (the registry, the `closed` listeners, the page-load watches, the disconnect
    listener), so a destroyed window leaves nothing behind.
  - Keep what the README says: `connect` throws Electron's own `TypeError` for a destroyed
    window. This task fixes the leak, not the error.
  - A failure at any later step of the setup must also leave nothing behind. If a step after the
    first registration can throw, undo the registrations that were made (the entries in
    `portEnds`, the `closed` listeners, the watches).
  - Check the other verbs for the same shape: `connect` of a `mainPort` channel takes one target
    and resolves its contents first, so it should be unaffected, and a test says so.
- **Tests:**
  - A unit test with fake windows: `connect(winA, winB)` with a destroyed `winB` throws, and then a
    `<channel>:disconnect` from `winA`'s contents with the key of the first end (`1:a`) does
    nothing: `winA` gets no `<channel>:close`. It fails without the fix. The same with a
    destroyed `winA`, and with the same window twice.
  - No `closed` or load listener is left on `winA` after the failed call (`listenerCount`).
  - A later `connect` with two live windows still works, and gets a fresh key.
  - A `mainPort` connect to a destroyed contents leaves nothing behind either.
  - A scenario in the real-Electron `ports` suite: a window that was destroyed before `connect`.
- **Delivered:** 2026-10-08. `connectPorts` reads `webContents` of both windows while it builds the
  ends, before anything is registered, so a destroyed window throws Electron's own `TypeError` and
  leaves nothing behind (the id is still taken, so a key is never reused). The setup (registry,
  disconnect listener, `closed` listeners, watches, first pairing) runs in a `try`; a failure calls
  `close()`, which removes the entries, listeners and watches and tells the windows, then rethrows.
  Deviation: `connectMainPort` gets the same rollback, and a guard that throws
  `TypeError('Object has been destroyed')` for *bare* contents that are already destroyed. Those
  did not throw before and left an entry in `portEnds` for good (a destroyed `WebContents` never
  emits `destroyed` again); a destroyed window or view already threw from its getter. The README
  already promised the error for a destroyed target. The `port` verb has no such guard, since a real
  destroyed window always throws from its getter. Tests: `ports.test.ts` and `mainPorts.test.ts` of
  the e2e suite (fake windows whose getter throws, listener counts, a failing `MessageChannelMain`),
  the golden text of the writer test, and two scenarios in the real-Electron `ports` suite.
