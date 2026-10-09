/*
 *   Apache License 2.0
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: Apache-2.0
 */

// The pages of the real-Electron tests of `port` and `mainPort` channels. The scenarios run in
// Electron and cannot see the test files, so the tests pass these as `data`.

/** A page which records what happens on the `chat` channel, from the moment that it loads. */
export const chatPage = `<!doctype html><title>chat</title><script>
   window.events = [];
   ipc.chat.on((...args) => events.push(["message", ...args]));
   ipc.chat.onReady(() => events.push(["ready"]));
   ipc.chat.onClose(() => events.push(["close"]));
</script>`;

/** A page which records what happens on the `logTail` channel, from the moment that it loads. */
export const logPage = `<!doctype html><title>log</title><script>
   window.events = [];
   ipc.logTail.on((...args) => events.push(["message", ...args]));
   ipc.logTail.onReady(() => events.push(["ready"]));
   ipc.logTail.onClose(() => events.push(["close"]));
</script>`;
