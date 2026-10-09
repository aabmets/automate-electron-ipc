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

import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;
/** `attachUtility` of the loaded `main.ts`: the children of the tests are attached when made (T86). */
let attachChild: ((child: unknown) => void) | undefined;

afterEach(async () => {
   attachChild = undefined;
   Reflect.deleteProperty(process, "parentPort");
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const wire = (name: string) => `autoipc:${name}`;
const ok = (value: unknown) => ({ ok: true, value });
const failed = (error: Record<string, unknown>) => ({ ok: false, error });
/** Lets the promises that are settled by a message run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A `UtilityProcess` stand-in: an emitter with `postMessage`, which the main process uses. It is
 * attached to the bindings like a child from `forkUtility`, unless `attached` is false.
 */
function createChild({ attached = true } = {}) {
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   if (attached) {
      attachChild?.(child);
   }
   /** The messages that the main process posted to the child, with the given tag. */
   const posted = (tag: string, channel?: string) =>
      child.postMessage.mock.calls
         .map(([message]) => message as Record<string, unknown>)
         .filter((m) => m.__ipc === tag && (channel === undefined || m.channel === wire(channel)));
   /** The child posts a message to the main process. */
   const emitFromChild = (message: unknown) => child.emit("message", message);
   return { child, posted, emitFromChild };
}

/** A `process.parentPort` stand-in, which the code in the utility process uses. */
function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   const posted = (tag: string, channel?: string) =>
      port.postMessage.mock.calls
         .map(([message]) => message as Record<string, unknown>)
         .filter((m) => m.__ipc === tag && (channel === undefined || m.channel === wire(channel)));
   /** The main process posts a message to the child, which arrives as `{ data }`. */
   const emitFromMain = (data: unknown) => port.emit("message", { data });
   return { port, posted, emitFromMain };
}

async function load(fixture = "utility-channels") {
   project = await runFixture(fixture);
   const main = loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() });
   attachChild = main.attachUtility;
   const utilitySource = project.generated["utility.ts"];
   const utility = utilitySource ? loadGenerated(utilitySource, {}) : undefined;
   return { main, utility };
}

describe("utility channels, files", () => {
   it("type-checks main.ts, utility.ts and the code which uses them", async () => {
      project = await runFixture("utility-channels");
      expect(await project.typecheck()).toBe("");
   });

   it("leaves the files for the renderer to the renderer channels", async () => {
      project = await runFixture("utility-channels");
      const preload = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: preload.electron });
      expect(callablePaths(preload.exposed.ipc)).toStrictEqual(["getJob.invoke"]);
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual(["getJob.invoke"]);
      expect(project.generated["window.d.ts"]).not.toContain("Summary");
      expect(project.generated["preload.ts"]).not.toContain("indexFile");
   });

   it("writes the utility file next to the other files by default, and only for utility channels", async () => {
      project = await runFixture("utility-channels");
      expect(project.generated["utility.ts"]).toContain("export const ipc = {");
      await project.cleanup();

      project = await runFixture("ask-channels");
      expect(project.generated["utility.ts"]).toBeUndefined();
      const files = await fsp.readdir(path.join(project.dir, project.ipcDataDir));
      expect(files).not.toContain("utility.ts");
   });

   it("writes the utility file to the configured path, and leaves empty files for the renderer", async () => {
      project = await runFixture("utility-custom-path");
      expect(project.generated["utility.ts"]).toContain(
         'import type { Row } from "../../ipc/schema";',
      );
      expect(project.generated["main.ts"]).toContain('import type { Row } from "./schema";');
      expect(await project.typecheck()).toBe("");
      const files = await fsp.readdir(path.join(project.dir, project.ipcDataDir));
      expect(files).not.toContain("utility.ts");

      expect(project.generated["preload.ts"]).not.toContain("ipcRenderer");
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual([]);
      expect(project.generated["window.d.ts"]).not.toContain("Row");
   });
});

describe("utility channels, children which the bindings do not know", () => {
   const notAttached = {
      name: "IpcUtilityError",
      code: "IPC_UTILITY_NOT_ATTACHED",
      message: expect.stringContaining("forkUtility()"),
   };

   it("rejects invoke, as a promise does, and posts nothing", async () => {
      const { main } = await load();
      const { child } = createChild({ attached: false });

      const call = main.ipc.indexFile.invoke(child, "a");

      await expect(call).rejects.toMatchObject({ ...notAttached, channel: wire("indexFile") });
      await expect(call).rejects.toThrow("attachUtility(child) right after utilityProcess.fork()");
      expect(child.postMessage).not.toHaveBeenCalled();
      expect(child.listenerCount("message")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
   });

   it("fails send, handle, on and once, and makes no peer for the child", async () => {
      const { main } = await load();
      const { child } = createChild({ attached: false });

      expect(() => main.ipc.pause.send(child)).toThrow(expect.objectContaining(notAttached));
      expect(() => main.ipc.getSetting.handle(child, async () => "x")).toThrow(
         expect.objectContaining({ ...notAttached, channel: wire("getSetting") }),
      );
      expect(() => main.ipc.progress.on(child, () => undefined)).toThrow(
         expect.objectContaining(notAttached),
      );
      expect(() => main.ipc.progress.once(child, () => undefined)).toThrow(
         expect.objectContaining(notAttached),
      );
      expect(child.listenerCount("message")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
   });

   it("serves a child once attachUtility is called for it", async () => {
      const { main } = await load();
      const { child, posted } = createChild({ attached: false });
      expect(() => main.ipc.pause.send(child)).toThrow();

      main.attachUtility(child);
      main.ipc.pause.send(child);

      expect(posted("send", "pause")).toHaveLength(1);
   });

   it("forks with utilityProcess.fork and the same arguments, and attaches the child at once", async () => {
      project = await runFixture("utility-channels");
      const electron = createFakeElectron();
      const { child, posted } = createChild({ attached: false });
      electron.utilityProcess.fork.mockReturnValue(child);
      const main = loadGenerated(project.generated["main.ts"], { electron });
      const options = { serviceName: "indexer" };

      const forked = main.forkUtility("/app/child.js", ["--flag"], options);

      expect(forked).toBe(child);
      expect(electron.utilityProcess.fork).toHaveBeenCalledTimes(1);
      expect(electron.utilityProcess.fork).toHaveBeenCalledWith(
         "/app/child.js",
         ["--flag"],
         options,
      );
      expect(child.listenerCount("message")).toBe(1);
      expect(child.listenerCount("exit")).toBe(1);

      // It exits before any channel used it: the later calls are rejected, and nothing is posted.
      child.emit("exit", 1);
      await expect(main.ipc.indexFile.invoke(forked, "a")).rejects.toMatchObject({
         code: "IPC_UTILITY_EXITED",
      });
      expect(() => main.ipc.pause.send(forked)).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_EXITED" }),
      );
      expect(posted("call")).toHaveLength(0);
   });

   it("answers a child which calls the main process from its start, when it was forked by forkUtility", async () => {
      project = await runFixture("utility-channels");
      const electron = createFakeElectron();
      const { child, posted, emitFromChild } = createChild({ attached: false });
      electron.utilityProcess.fork.mockReturnValue(child);
      const main = loadGenerated(project.generated["main.ts"], { electron });

      main.forkUtility("/app/child.js");
      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 7, args: ["k"] });
      await flush();

      expect(posted("reply")[0]).toMatchObject({ id: 7, envelope: { ok: false } });
   });
});

describe("utility channels, main process, calling the child", () => {
   it("posts the call with an ID, and resolves with the answer", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "/tmp");

      const [call] = posted("call", "indexFile");
      expect(call).toStrictEqual({
         __ipc: "call",
         channel: wire("indexFile"),
         id: expect.any(Number),
         args: ["/tmp"],
      });
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: call.id, envelope: ok(3) });
      await expect(answer).resolves.toBe(3);
   });

   it("spreads rest arguments, and sends none for a signature without parameters", async () => {
      const { main } = await load();
      const { child, posted } = createChild();

      main.ipc.runJob.invoke(child, { id: 1, path: "a" }, "x", "y");
      main.ipc.reset.invoke(child);

      expect(posted("call", "runJob")[0].args).toStrictEqual([{ id: 1, path: "a" }, "x", "y"]);
      expect(posted("call", "reset")[0].args).toStrictEqual([]);
   });

   it("answers concurrent calls by their IDs, in any order", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const first = main.ipc.indexFile.invoke(child, "a");
      const second = main.ipc.indexFile.invoke(child, "b");
      const [one, two] = posted("call", "indexFile");
      expect(one.id).not.toBe(two.id);
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: two.id, envelope: ok(2) });
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: one.id, envelope: ok(1) });

      await expect(first).resolves.toBe(1);
      await expect(second).resolves.toBe(2);
   });

   it("rejects with an IpcUtilityError which carries what the handler threw", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "/missing");
      const [call] = posted("call", "indexFile");
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: failed({
            name: "NotFound",
            message: "No such file",
            code: "ENOENT",
            data: { a: 1 },
         }),
      });

      const error = await answer.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(main.IpcUtilityError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
         name: "NotFound",
         message: "No such file",
         code: "ENOENT",
         data: { a: 1 },
         channel: wire("indexFile"),
      });
   });

   it.each([
      ["a missing envelope", undefined],
      ["an envelope that is not an object", "yes"],
      ["an envelope of an unknown shape", { ok: "maybe" }],
      ["a failure without an error", { ok: false }],
   ])("rejects with IPC_UTILITY_INVALID_REPLY for %s", async (_name, envelope) => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: call.id, envelope });

      await expect(answer).rejects.toMatchObject({ code: "IPC_UTILITY_INVALID_REPLY" });
   });

   it("reads a failure with unusual fields as an error with defaults", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: failed({ name: "", message: 5, code: {} }),
      });

      const error = await answer.catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: "Error", code: undefined });
      expect((error as Error).message).toBe("The other side failed without a message");
   });

   it("ignores replies it cannot trust, and keeps waiting", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      const other = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      // The wrong channel, an ID which is not pending, an ID of another type, and another child.
      emitFromChild({ __ipc: "reply", channel: wire("runJob"), id: call.id, envelope: ok(0) });
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id + 100,
         envelope: ok(0),
      });
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: String(call.id),
         envelope: ok(0),
      });
      other.emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: ok(0),
      });
      // Messages which are not the library's, and are left to the application.
      for (const message of [
         null,
         undefined,
         7,
         "text",
         [],
         { type: "other" },
         { __ipc: 1 },
         { __ipc: "reply" },
      ]) {
         emitFromChild(message);
      }
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: call.id, envelope: ok(9) });

      await expect(answer).resolves.toBe(9);
   });

   it("settles a call once: a second reply is dropped", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      const reply = (value: number) =>
         emitFromChild({
            __ipc: "reply",
            channel: wire("indexFile"),
            id: call.id,
            envelope: ok(value),
         });
      reply(1);
      reply(2);

      await expect(answer).resolves.toBe(1);
   });

   it("rejects every pending call when the child exits, and the later calls and sends", async () => {
      const { main } = await load();
      const { child } = createChild();

      const first = main.ipc.indexFile.invoke(child, "a");
      const second = main.ipc.reset.invoke(child);
      child.emit("exit", 1);

      await expect(first).rejects.toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_EXITED",
         channel: wire("indexFile"),
      });
      await expect(first).rejects.toThrow(
         "The utility process exited before the channel 'autoipc:indexFile' was answered",
      );
      await expect(second).rejects.toMatchObject({
         code: "IPC_UTILITY_EXITED",
         channel: wire("reset"),
      });

      await expect(main.ipc.indexFile.invoke(child, "b")).rejects.toMatchObject({
         code: "IPC_UTILITY_EXITED",
      });
      expect(() => main.ipc.pause.send(child)).toThrow(main.IpcUtilityError);
      expect(child.postMessage).toHaveBeenCalledTimes(2);
   });

   it("rejects a call to a child that exited right after it was attached, and fails the sends", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.emit("exit", 0);

      await expect(main.ipc.indexFile.invoke(child, "a")).rejects.toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_EXITED",
         channel: wire("indexFile"),
      });
      expect(() => main.ipc.pause.send(child)).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_EXITED" }),
      );
      expect(child.postMessage).not.toHaveBeenCalled();
   });

   it("does not answer a call from the child after it exited, and a second exit changes nothing", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, async () => "x");

      child.emit("exit", 0);
      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["a"] });
      await flush();

      expect(child.postMessage).not.toHaveBeenCalled();
      expect(() => child.emit("exit", 0)).not.toThrow();
   });

   it("keeps calls to one child apart from another child", async () => {
      const { main } = await load();
      const one = createChild();
      const two = createChild();

      const first = main.ipc.indexFile.invoke(one.child, "a");
      const second = main.ipc.indexFile.invoke(two.child, "b");
      two.child.emit("exit", 1);

      await expect(second).rejects.toMatchObject({ code: "IPC_UTILITY_EXITED" });
      const [call] = one.posted("call", "indexFile");
      one.emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: ok(5),
      });
      await expect(first).resolves.toBe(5);
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the arguments cannot be posted", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("An object could not be cloned.");
      });

      const answer = main.ipc.indexFile.invoke(child, "a");

      await expect(answer).rejects.toMatchObject({
         code: "IPC_UTILITY_UNSENDABLE",
         channel: wire("indexFile"),
      });
      await expect(answer).rejects.toThrow("An object could not be cloned.");
      // The call is not left pending, so an exit rejects nothing more.
      expect(() => child.emit("exit", 1)).not.toThrow();
   });

   it("describes a thing which is thrown but is not an error", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         // biome-ignore lint/style/useThrowOnlyError: a value which is not an error is the case under test
         throw "plain text";
      });

      await expect(main.ipc.indexFile.invoke(child, "a")).rejects.toThrow("plain text");
   });
});

describe("utility channels, main process, notifying the child", () => {
   it("posts a one-way message with the arguments", async () => {
      const { main } = await load();
      const { child, posted } = createChild();

      expect(main.ipc.setLogLevel.send(child, "debug")).toBeUndefined();
      main.ipc.pause.send(child);

      expect(posted("send", "setLogLevel")).toStrictEqual([
         { __ipc: "send", channel: wire("setLogLevel"), args: ["debug"] },
      ]);
      expect(posted("send", "pause")[0].args).toStrictEqual([]);
   });

   it("throws IPC_UTILITY_UNSENDABLE when the message cannot be posted", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("cannot clone");
      });

      expect(() => main.ipc.setLogLevel.send(child, "debug")).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_UNSENDABLE" }),
      );
   });
});

describe("utility channels, main process, handling the calls of the child", () => {
   it("calls the handler with the arguments, and replies with the envelope", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      const handler = vi.fn(async (key: string, fallback?: string) => `${key}:${fallback}`);
      main.ipc.getSetting.handle(child, handler);

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 4, args: ["theme", "dark"] });
      await flush();

      expect(handler).toHaveBeenCalledWith("theme", "dark");
      expect(posted("reply")).toStrictEqual([
         { __ipc: "reply", channel: wire("getSetting"), id: 4, envelope: ok("theme:dark") },
      ]);
   });

   it("replies with the error of a handler which throws, without its stack", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, () => {
         throw Object.assign(new RangeError("out of range"), { code: 7, data: { at: 1 } });
      });

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(posted("reply")[0].envelope).toStrictEqual(
         failed({ name: "RangeError", message: "out of range", code: 7, data: { at: 1 } }),
      );
   });

   it("replies with IPC_UTILITY_NO_HANDLER when no handler is registered", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, async () => "x");

      emitFromChild({ __ipc: "call", channel: wire("report"), id: 2, args: [{ files: 1 }] });
      await flush();

      expect(posted("reply")[0]).toMatchObject({
         id: 2,
         channel: wire("report"),
         envelope: failed({
            name: "IpcUtilityError",
            message: "The other side has no handler for the channel 'autoipc:report'",
            code: "IPC_UTILITY_NO_HANDLER",
         }),
      });
   });

   it("answers a child which calls before any channel has used it, once attached", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild({ attached: false });

      main.attachUtility(child);
      main.attachUtility(child);
      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(child.listenerCount("message")).toBe(1);
      expect(posted("reply")[0].envelope).toMatchObject({ ok: false });
   });

   it("keeps the handlers of two children apart", async () => {
      const { main } = await load();
      const one = createChild();
      const two = createChild();
      main.ipc.getSetting.handle(one.child, async () => "one");
      main.ipc.getSetting.handle(two.child, async () => "two");

      one.emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      two.emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(one.posted("reply")[0].envelope).toStrictEqual(ok("one"));
      expect(two.posted("reply")[0].envelope).toStrictEqual(ok("two"));
   });

   it("replaces a handler, and a disposer removes only its own handler", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      const removeFirst = main.ipc.getSetting.handle(child, async () => "first");
      const removeSecond = main.ipc.getSetting.handle(child, async () => "second");
      const call = (id: number) =>
         emitFromChild({ __ipc: "call", channel: wire("getSetting"), id, args: ["k"] });

      call(1);
      removeFirst();
      call(2);
      await flush();
      expect(posted("reply").map((reply) => reply.envelope)).toStrictEqual([
         ok("second"),
         ok("second"),
      ]);

      removeSecond();
      call(3);
      await flush();
      expect(posted("reply")[2].envelope).toMatchObject({
         ok: false,
         error: { code: "IPC_UTILITY_NO_HANDLER" },
      });
   });

   it("replies with IPC_UTILITY_UNSENDABLE when the result cannot be posted", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, async () => "x");
      child.postMessage.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(posted("reply")[1]).toStrictEqual({
         __ipc: "reply",
         channel: wire("getSetting"),
         id: 1,
         envelope: failed({
            name: "IpcUtilityError",
            message:
               "A message of the channel 'autoipc:getSetting' cannot be sent: An object could not be cloned.",
            code: "IPC_UTILITY_UNSENDABLE",
         }),
      });
   });

   it("logs, and does not throw, when even the failure cannot be posted", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      main.ipc.getSetting.handle(child, async () => "x");
      child.postMessage.mockImplementation(() => {
         throw new Error("the port is closed");
      });

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(log).toHaveBeenCalledOnce();
   });

   it.each([
      ["an ID which is not a number", { id: "1", args: [] }],
      ["no ID", { args: [] }],
      ["arguments which are not an array", { id: 1, args: "x" }],
   ])("drops a call with %s", async (_name, fields) => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const handler = vi.fn(async () => "x");
      main.ipc.getSetting.handle(child, handler);

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), ...fields });
      await flush();

      expect(handler).not.toHaveBeenCalled();
      expect(child.postMessage).not.toHaveBeenCalled();
   });
});

describe("utility channels, main process, listening to the child", () => {
   it("calls the listeners of the child which sent the message, in order", async () => {
      const { main } = await load();
      const one = createChild();
      const two = createChild();
      const seen: string[] = [];
      main.ipc.progress.on(one.child, (done: number, total: number) =>
         seen.push(`a${done}/${total}`),
      );
      main.ipc.progress.on(one.child, (done: number) => seen.push(`b${done}`));
      main.ipc.progress.on(two.child, (done: number) => seen.push(`other${done}`));

      one.emitFromChild({ __ipc: "send", channel: wire("progress"), args: [1, 4] });

      expect(seen).toStrictEqual(["a1/4", "b1"]);
   });

   it("removes a listener with its disposer, and the same callback can be added twice", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const callback = vi.fn();
      const removeFirst = main.ipc.progress.on(child, callback);
      main.ipc.progress.on(child, callback);
      const message = { __ipc: "send", channel: wire("progress"), args: [1, 2] };

      emitFromChild(message);
      expect(callback).toHaveBeenCalledTimes(2);
      removeFirst();
      removeFirst();
      emitFromChild(message);
      expect(callback).toHaveBeenCalledTimes(3);
   });

   it("calls a once listener one time, and not after its disposer ran", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const used = vi.fn();
      const removed = vi.fn();
      main.ipc.progress.once(child, used);
      main.ipc.progress.once(child, removed)();
      const message = { __ipc: "send", channel: wire("progress"), args: [1, 2] };

      emitFromChild(message);
      emitFromChild(message);

      expect(used).toHaveBeenCalledOnce();
      expect(removed).not.toHaveBeenCalled();
   });

   it("reports a listener which throws or rejects, and still calls the others", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const after = vi.fn();
      main.ipc.progress.on(child, () => {
         throw new Error("sync failure");
      });
      main.ipc.progress.on(child, () => Promise.reject(new Error("async failure")));
      main.ipc.progress.on(child, after);

      emitFromChild({ __ipc: "send", channel: wire("progress"), args: [1, 2] });
      await flush();

      expect(after).toHaveBeenCalledOnce();
      expect(log.mock.calls.map(([error]) => (error as Error).message).sort()).toStrictEqual([
         "async failure",
         "sync failure",
      ]);
   });

   it("ignores a message of another channel and one whose arguments are not an array", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const callback = vi.fn();
      main.ipc.progress.on(child, callback);

      emitFromChild({ __ipc: "send", channel: wire("jobDone"), args: [1, 2] });
      emitFromChild({ __ipc: "send", channel: wire("progress"), args: "12" });
      emitFromChild({ __ipc: "send", channel: wire("progress") });

      expect(callback).not.toHaveBeenCalled();
   });
});

describe("utility channels, utility process, handling the calls of the main process", () => {
   it("calls the handler with the arguments, and replies with the envelope", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      const handler = vi.fn(async (path: string) => path.length);
      utility.ipc.indexFile.handle(handler);

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 3, args: ["/tmp"] });
      await flush();

      expect(handler).toHaveBeenCalledWith("/tmp");
      expect(posted("reply")).toStrictEqual([
         { __ipc: "reply", channel: wire("indexFile"), id: 3, envelope: ok(4) },
      ]);
   });

   it("replies with a value of a synchronous handler, and spreads the rest arguments", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      utility.ipc.runJob.handle((job: { id: number }, ...tags: string[]) => ({
         files: job.id + tags.length,
      }));

      emitFromMain({ __ipc: "call", channel: wire("runJob"), id: 1, args: [{ id: 10 }, "a", "b"] });
      await flush();

      expect(posted("reply")[0].envelope).toStrictEqual(ok({ files: 12 }));
   });

   it("replies with the error of a handler which throws", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      utility.ipc.indexFile.handle(() => {
         throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 1, args: ["a"] });
      await flush();

      expect(posted("reply")[0].envelope).toStrictEqual(
         failed({ name: "Error", message: "disk full", code: "ENOSPC" }),
      );
   });

   it("replies with IPC_UTILITY_NO_HANDLER for a channel without a handler, and after the disposer", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      const remove = utility.ipc.indexFile.handle(async () => 1);
      remove();

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 1, args: ["a"] });
      emitFromMain({ __ipc: "call", channel: wire("reset"), id: 2, args: [] });
      await flush();

      expect(posted("reply").map((reply) => (reply.envelope as any).error.code)).toStrictEqual([
         "IPC_UTILITY_NO_HANDLER",
         "IPC_UTILITY_NO_HANDLER",
      ]);
   });

   it("registers one listener on the port, however many channels are used", async () => {
      const { utility } = await load();
      const { port } = createParentPort();

      utility.ipc.indexFile.handle(async () => 1);
      utility.ipc.pause.on(() => undefined);
      utility.ipc.getSetting.invoke("a");

      expect(port.listenerCount("message")).toBe(1);
   });

   it("replies with IPC_UTILITY_UNSENDABLE when the result cannot be posted", async () => {
      const { utility } = await load();
      const { port, posted, emitFromMain } = createParentPort();
      utility.ipc.indexFile.handle(async () => 1);
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 1, args: ["a"] });
      await flush();

      expect((posted("reply")[1].envelope as any).error.code).toBe("IPC_UTILITY_UNSENDABLE");
   });
});

describe("utility channels, utility process, notifications and calls to the main process", () => {
   it("calls the listeners of a notification, and a once listener one time", async () => {
      const { utility } = await load();
      const { emitFromMain } = createParentPort();
      const on = vi.fn();
      const once = vi.fn();
      utility.ipc.setLogLevel.on(on);
      utility.ipc.setLogLevel.once(once);
      const message = { __ipc: "send", channel: wire("setLogLevel"), args: ["debug"] };

      emitFromMain(message);
      emitFromMain(message);

      expect(on).toHaveBeenCalledTimes(2);
      expect(on).toHaveBeenCalledWith("debug");
      expect(once).toHaveBeenCalledOnce();
   });

   it("posts a one-way message with the arguments", async () => {
      const { utility } = await load();
      const { posted } = createParentPort();

      utility.ipc.progress.send(1, 2);
      utility.ipc.jobDone.send({ id: 1, path: "a" });

      expect(posted("send", "progress")[0].args).toStrictEqual([1, 2]);
      expect(posted("send", "jobDone")[0].args).toStrictEqual([{ id: 1, path: "a" }]);
   });

   it("posts the call with an ID, and resolves with the answer or rejects with the error", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();

      const found = utility.ipc.getSetting.invoke("theme");
      const missing = utility.ipc.getSetting.invoke("missing", "none");
      const [one, two] = posted("call", "getSetting");
      expect(one.args).toStrictEqual(["theme", undefined]);
      expect(two.args).toStrictEqual(["missing", "none"]);
      emitFromMain({
         __ipc: "reply",
         channel: wire("getSetting"),
         id: one.id,
         envelope: ok("dark"),
      });
      emitFromMain({
         __ipc: "reply",
         channel: wire("getSetting"),
         id: two.id,
         envelope: failed({ name: "KeyError", message: "unknown key", code: "E_KEY" }),
      });

      await expect(found).resolves.toBe("dark");
      const error = await missing.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(utility.IpcUtilityError);
      expect(error).toMatchObject({ name: "KeyError", message: "unknown key", code: "E_KEY" });
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the arguments cannot be posted", async () => {
      const { utility } = await load();
      const { port } = createParentPort();
      port.postMessage.mockImplementation(() => {
         throw new Error("An object could not be cloned.");
      });

      await expect(utility.ipc.getSetting.invoke("a")).rejects.toMatchObject({
         code: "IPC_UTILITY_UNSENDABLE",
      });
      expect(() => utility.ipc.progress.send(1, 2)).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_UNSENDABLE" }),
      );
   });

   it("fails with a clear error outside a utility process, and can still be imported there", async () => {
      const { utility } = await load();

      expect(() => utility.ipc.progress.send(1, 2)).toThrow(/only in an Electron utility process/);
      expect(() => utility.ipc.indexFile.handle(async () => 1)).toThrow(TypeError);

      // The port appears later in the same process: nothing was cached from the failed attempts.
      const { posted } = createParentPort();
      utility.ipc.progress.send(1, 2);
      expect(posted("send", "progress")).toHaveLength(1);
   });
});

describe("utility channels, main process and utility process together", () => {
   it("connects the two ends of every channel over a pair of ports", async () => {
      const { main, utility } = await load();
      const { child, emitFromChild } = createChild();
      const { port, emitFromMain } = createParentPort();
      // Each side posts to the other: the child posts to the port, and the port to the child.
      child.postMessage.mockImplementation((message) => emitFromMain(message));
      port.postMessage.mockImplementation((message) => emitFromChild(message));

      utility.ipc.indexFile.handle(async (path: string) => path.length);
      main.ipc.getSetting.handle(child, async (key: string) => key.toUpperCase());
      const seen: number[] = [];
      main.ipc.progress.on(child, (done: number) => seen.push(done));
      const levels: string[] = [];
      utility.ipc.setLogLevel.on((level: string) => levels.push(level));

      const length = await main.ipc.indexFile.invoke(child, "/tmp/file");
      const setting = await utility.ipc.getSetting.invoke("theme");
      utility.ipc.progress.send(3, 4);
      main.ipc.setLogLevel.send(child, "info");

      expect(length).toBe(9);
      expect(setting).toBe("THEME");
      expect(seen).toStrictEqual([3]);
      expect(levels).toStrictEqual(["info"]);
   });
});
