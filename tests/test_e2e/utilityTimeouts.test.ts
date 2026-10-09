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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await

import { EventEmitter } from "node:events";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const ok = (value: unknown) => ({ ok: true, value });

let project: E2EProject | undefined;

afterEach(async () => {
   attachChild = undefined;
   vi.useRealTimers();
   Reflect.deleteProperty(process, "parentPort");
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

/** Starts a call and watches how it settles, so that no rejection is left unhandled. */
function track(promise: Promise<unknown>) {
   const state: { status: "pending" | "resolved" | "rejected"; value?: any } = {
      status: "pending",
   };
   promise.then(
      (value) => {
         state.status = "resolved";
         state.value = value;
      },
      (error) => {
         state.status = "rejected";
         state.value = error;
      },
   );
   return state;
}

/** `attachUtility` of the loaded `main.ts`: the children of the tests are attached when made (T86). */
let attachChild: ((child: unknown) => void) | undefined;

/** A `UtilityProcess` stand-in: an emitter with `postMessage`, which the main process uses. */
function createChild() {
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   attachChild?.(child);
   const posted = (channel: string) =>
      child.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((m) => m.__ipc === "call" && m.channel === wire(channel));
   const reply = (channel: string, id: number, envelope: unknown) =>
      child.emit("message", { __ipc: "reply", channel: wire(channel), id, envelope });
   return { child, posted, reply };
}

/** A `process.parentPort` stand-in, which the code in the utility process uses. */
function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   const posted = (channel: string) =>
      port.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((m) => m.__ipc === "call" && m.channel === wire(channel));
   const reply = (channel: string, id: number, envelope: unknown) =>
      port.emit("message", { data: { __ipc: "reply", channel: wire(channel), id, envelope } });
   return { port, posted, reply };
}

describe("fixture utility-timeouts", () => {
   it("generates files that type-check, including the timeout code", async () => {
      project = await runFixture("utility-timeouts");
      expect(await project.typecheck()).toBe("");
   });

   it("adds the timeout to the calls of a channel that has one, and to none else", async () => {
      project = await runFixture("utility-timeouts");
      const main = project.generated["main.ts"];
      const utility = project.generated["utility.ts"];
      const preload = project.generated["preload.ts"];

      expect(main).toMatch(/callUtilityChild\(child, 'autoipc:slowIndex'.*, 1000\)/);
      expect(main).toMatch(/'autoipc:defaultedIndex', \[path\], 5000\)/);
      expect(main).toMatch(/'autoipc:legacyIndex', \[\], 300\)/);
      expect(main).not.toMatch(/'autoipc:patientIndex'.*, \d+\)/);
      expect(utility).toMatch(/'autoipc:slowSetting', \[key\], 800\)/);
      expect(utility).toMatch(/'autoipc:defaultedSetting', \[key\], 5000\)/);
      expect(utility).not.toMatch(/'autoipc:patientSetting'.*, \d+\)/);
      expect(preload).toContain("callUtilityPort(utilityClients['slowQuery'], args, 1200)");
      expect(preload).toContain("callUtilityPort(utilityClients['defaultedQuery'], args, 5000)");
      expect(preload).toContain("callUtilityPort(utilityClients['patientQuery'], args)");
      // The default of the config does not time a stream.
      expect(preload).toContain("openUtilityStream(utilityClients['slowRows'], args, 1024, 700)");
      expect(preload).toMatch(/openUtilityStream\(utilityClients\['plainRows'\], args, \d+\)/);
   });

   it("declares the timeout code in window.d.ts", async () => {
      project = await runFixture("utility-timeouts");
      expect(project.generated["window.d.ts"]).toContain("'IPC_UTILITY_TIMEOUT'");
   });

   it("does not write the timers into a project without a timeout", async () => {
      project = await runFixture("utility-channels");
      expect(project.generated["main.ts"]).not.toMatch(/callUtilityPeer\([^)]*\), \d+\)/);
      expect(project.generated["utility.ts"]).not.toMatch(/callUtilityPeer\([^)]*\), \d+\)/);
   });
});

describe("timeouts of callUtility, in the main process", () => {
   async function load() {
      project = await runFixture("utility-timeouts");
      const main = loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() });
      attachChild = main.attachUtility;
      return main;
   }

   it("rejects with IPC_UTILITY_TIMEOUT when the child does not answer in time", async () => {
      vi.useFakeTimers();
      const { ipc, IpcUtilityError } = await load();
      const { child } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));

      await vi.advanceTimersByTimeAsync(999);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.status).toBe("rejected");
      expect(call.value).toBeInstanceOf(IpcUtilityError);
      expect(call.value).toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_TIMEOUT",
         channel: wire("slowIndex"),
         message: `The channel '${wire("slowIndex")}' did not answer within 1000 ms`,
      });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("resolves, and clears the timer, when the child answers in time", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));

      await vi.advanceTimersByTimeAsync(500);
      reply("slowIndex", posted("slowIndex")[0].id, ok(7));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toMatchObject({ status: "resolved", value: 7 });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("rejects with the error of the handler, and clears the timer, when it fails in time", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));

      reply("slowIndex", posted("slowIndex")[0].id, {
         ok: false,
         error: { name: "RangeError", message: "out", code: "E_RANGE" },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect(call.value).toMatchObject({ name: "RangeError", code: "E_RANGE" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("drops the late reply after the timeout", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));
      const id = posted("slowIndex")[0].id;

      await vi.advanceTimersByTimeAsync(1000);
      reply("slowIndex", id, ok(7));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect(call.value.code).toBe("IPC_UTILITY_TIMEOUT");
   });

   it("uses the default of the config for a channel without the option", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.defaultedIndex.invoke(child, "a.txt"));

      await vi.advanceTimersByTimeAsync(4999);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
      expect(call.value.message).toContain("within 5000 ms");
   });

   it("waits for ever on a channel with timeoutMs 0, though the config has a default", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.patientIndex.invoke(child));

      await vi.advanceTimersByTimeAsync(1_000_000);

      expect(call.status).toBe("pending");
      expect(vi.getTimerCount()).toBe(0);
   });

   it("applies the option of the alternative form", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.legacyIndex.invoke(child));

      await vi.advanceTimersByTimeAsync(300);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
   });

   it("times each call on its own", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const first = track(ipc.slowIndex.invoke(child, "a"));
      await vi.advanceTimersByTimeAsync(600);
      const second = track(ipc.slowIndex.invoke(child, "b"));
      await vi.advanceTimersByTimeAsync(400);

      expect(first.status).toBe("rejected");
      expect(second.status).toBe("pending");
      reply("slowIndex", posted("slowIndex")[1].id, ok(2));
      await vi.advanceTimersByTimeAsync(0);
      expect(second).toMatchObject({ status: "resolved", value: 2 });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("clears the timer when the child exits, which rejects the call with IPC_UTILITY_EXITED", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a"));

      child.emit("exit", 1);
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("clears the timer, and rejects, for a message that cannot be posted", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("not cloneable");
      });
      const call = track(ipc.slowIndex.invoke(child, "a"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_UNSENDABLE" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("does not start a timer for a call on a child that is gone", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      ipc.pause.send(child);
      child.emit("exit", 1);

      const call = track(ipc.slowIndex.invoke(child, "a"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("does not time a notification, which has no reply", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();

      ipc.pause.send(child);

      expect(vi.getTimerCount()).toBe(0);
   });
});

describe("timeouts of callMain, in the utility process", () => {
   async function load() {
      project = await runFixture("utility-timeouts");
      const parent = createParentPort();
      const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});
      return { ...parent, ipc: utility.ipc, IpcUtilityError: utility.IpcUtilityError };
   }

   it("rejects with IPC_UTILITY_TIMEOUT when the main process does not answer in time", async () => {
      vi.useFakeTimers();
      const { ipc, IpcUtilityError } = await load();
      const call = track(ipc.slowSetting.invoke("theme"));

      await vi.advanceTimersByTimeAsync(799);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.value).toBeInstanceOf(IpcUtilityError);
      expect(call.value).toMatchObject({
         code: "IPC_UTILITY_TIMEOUT",
         channel: wire("slowSetting"),
         message: `The channel '${wire("slowSetting")}' did not answer within 800 ms`,
      });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("resolves, clears the timer and drops nothing when the main process answers in time", async () => {
      vi.useFakeTimers();
      const { ipc, posted, reply } = await load();
      const call = track(ipc.slowSetting.invoke("theme"));

      reply("slowSetting", posted("slowSetting")[0].id, ok("dark"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toMatchObject({ status: "resolved", value: "dark" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("drops the late reply after the timeout", async () => {
      vi.useFakeTimers();
      const { ipc, posted, reply } = await load();
      const call = track(ipc.slowSetting.invoke("theme"));
      const id = posted("slowSetting")[0].id;

      await vi.advanceTimersByTimeAsync(800);
      reply("slowSetting", id, ok("dark"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value.code).toBe("IPC_UTILITY_TIMEOUT");
   });

   it("uses the default of the config, and none for timeoutMs 0", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const defaulted = track(ipc.defaultedSetting.invoke("theme"));
      const patient = track(ipc.patientSetting.invoke());

      await vi.advanceTimersByTimeAsync(5000);

      expect(defaulted.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
      expect(patient.status).toBe("pending");
      expect(vi.getTimerCount()).toBe(0);
   });
});

/** A `MessagePort` of the page: records what is posted, and delivers what the test says. */
class FakePagePort {
   onmessage: ((event: { data: unknown }) => void) | null = null;
   readonly postMessage = vi.fn();
   readonly close = vi.fn();
   private readonly closeListeners: (() => void)[] = [];
   addEventListener(type: string, listener: () => void) {
      if (type === "close") {
         this.closeListeners.push(listener);
      }
   }
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
   posted(tag: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => message.__ipc === tag);
   }
}

describe("timeouts of invokeUtility and streamUtility, in the page", () => {
   async function load() {
      project = await runFixture("utility-timeouts");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
      const listener = (channel: string) => {
         const found = fake.electron.ipcRenderer.on.mock.calls.find(
            ([name]: [string]) => name === channel,
         );
         return found?.[1] as (event: unknown, key: unknown) => void;
      };
      const arrive = (name: string, key = "1:utility") => {
         const port = new FakePagePort();
         listener(wire(name))({ ports: [port] }, key);
         return port;
      };
      const closeFromMain = (name: string, key: string) => listener(`${wire(name)}:close`)({}, key);
      return { api: fake.exposed.ipc, arrive, closeFromMain };
   }

   describe("calls", () => {
      it("rejects with the plain object of IPC_UTILITY_TIMEOUT when the child does not answer in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));

         await vi.advanceTimersByTimeAsync(1199);
         expect(call.status).toBe("pending");
         await vi.advanceTimersByTimeAsync(1);

         expect(call.status).toBe("rejected");
         expect(Object.getPrototypeOf(call.value)).toBe(Object.prototype);
         expect(call.value).toStrictEqual({
            name: "IpcUtilityError",
            message: `The channel 'slowQuery' did not answer within 1200 ms`,
            code: "IPC_UTILITY_TIMEOUT",
         });
         expect(port.posted("call")).toHaveLength(1);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("resolves, and clears the timer, when the child answers in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));

         await vi.advanceTimersByTimeAsync(600);
         port.deliver({
            __ipc: "reply",
            channel: wire("slowQuery"),
            id: port.posted("call")[0].id,
            envelope: ok("rows"),
         });
         await vi.advanceTimersByTimeAsync(0);

         expect(call).toMatchObject({ status: "resolved", value: "rows" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("rejects with the error of the handler, and clears the timer, when it fails in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));

         port.deliver({
            __ipc: "reply",
            channel: wire("slowQuery"),
            id: port.posted("call")[0].id,
            envelope: { ok: false, error: { name: "QueryError", message: "bad", code: "E_Q" } },
         });
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value).toMatchObject({ name: "QueryError", code: "E_Q" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("drops the late reply after the timeout", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));
         const id = port.posted("call")[0].id;

         await vi.advanceTimersByTimeAsync(1200);
         port.deliver({ __ipc: "reply", channel: wire("slowQuery"), id, envelope: ok("late") });
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value.code).toBe("IPC_UTILITY_TIMEOUT");
      });

      it("counts the wait for the port, and does not send the call afterwards", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const call = track(api.slowQuery.invoke("select 1"));

         await vi.advanceTimersByTimeAsync(1200);
         expect(call.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
         const port = arrive("slowQuery");

         expect(port.posted("call")).toHaveLength(0);
      });

      it("clears the timer when the connection closes, which rejects with IPC_UTILITY_EXITED", async () => {
         vi.useFakeTimers();
         const { api, arrive, closeFromMain } = await load();
         arrive("slowQuery", "k1");
         const call = track(api.slowQuery.invoke("select 1"));

         closeFromMain("slowQuery", "k1");
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("clears the timer when the call cannot be posted", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         port.postMessage.mockImplementation(() => {
            throw new Error("not cloneable");
         });
         const call = track(api.slowQuery.invoke("select 1"));
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value).toMatchObject({ code: "IPC_UTILITY_UNSENDABLE" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("uses the default of the config, and none for timeoutMs 0", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         arrive("defaultedQuery");
         arrive("patientQuery");
         const defaulted = track(api.defaultedQuery.invoke("select 1"));
         const patient = track(api.patientQuery.invoke());

         await vi.advanceTimersByTimeAsync(5000);

         expect(defaulted.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
         expect(defaulted.value.message).toContain("within 5000 ms");
         expect(patient.status).toBe("pending");
      });
   });

   describe("streams", () => {
      it("cancels the stream in the child and fails the read when no chunk arrives in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");
         const read = track(stream.next());
         const id = port.posted("stream")[0].id;

         await vi.advanceTimersByTimeAsync(699);
         expect(read.status).toBe("pending");
         await vi.advanceTimersByTimeAsync(1);

         expect(read.status).toBe("rejected");
         expect(Object.getPrototypeOf(read.value)).toBe(Object.prototype);
         expect(read.value).toStrictEqual({
            name: "IpcUtilityError",
            message: `The channel 'slowRows' did not answer within 700 ms`,
            code: "IPC_UTILITY_TIMEOUT",
         });
         expect(port.posted("cancel")).toStrictEqual([
            { __ipc: "cancel", channel: wire("slowRows"), id },
         ]);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("drops the chunks that arrive after the timeout", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");
         const first = track(stream.next());
         const id = port.posted("stream")[0].id;

         await vi.advanceTimersByTimeAsync(700);
         port.deliver({ __ipc: "chunk", channel: wire("slowRows"), id, value: 1 });
         const second = track(stream.next());
         await vi.advanceTimersByTimeAsync(0);

         expect(first.status).toBe("rejected");
         expect(second).toMatchObject({ status: "resolved", value: { done: true } });
      });

      it("does not cut a stream short after its first chunk", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");
         const first = track(stream.next());
         const id = port.posted("stream")[0].id;

         await vi.advanceTimersByTimeAsync(300);
         port.deliver({ __ipc: "chunk", channel: wire("slowRows"), id, value: 1 });
         await vi.advanceTimersByTimeAsync(0);
         const second = track(stream.next());
         await vi.advanceTimersByTimeAsync(100_000);

         expect(first).toMatchObject({ status: "resolved", value: { done: false, value: 1 } });
         expect(second.status).toBe("pending");
         expect(port.posted("cancel")).toHaveLength(0);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("ends the wait when the stream ends or fails before the first chunk", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const ended = api.slowRows.stream("rows");
         const endedRead = track(ended.next());
         port.deliver({
            __ipc: "end",
            channel: wire("slowRows"),
            id: port.posted("stream")[0].id,
         });
         await vi.advanceTimersByTimeAsync(0);
         const failing = api.slowRows.stream("rows");
         const failedRead = track(failing.next());
         port.deliver({
            __ipc: "error",
            channel: wire("slowRows"),
            id: port.posted("stream")[1].id,
            error: { name: "Boom", message: "x" },
         });
         await vi.advanceTimersByTimeAsync(0);

         expect(endedRead).toMatchObject({ status: "resolved", value: { done: true } });
         expect(failedRead.value).toMatchObject({ name: "Boom" });
         expect(vi.getTimerCount()).toBe(0);
         expect(port.posted("cancel")).toHaveLength(0);
      });

      it("clears the timer when the page cancels the stream", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");

         stream.cancel();
         await vi.advanceTimersByTimeAsync(10_000);

         expect(port.posted("cancel")).toHaveLength(1);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("counts the wait for the port, and does not start the stream afterwards", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const stream = api.slowRows.stream("rows");
         const read = track(stream.next());

         await vi.advanceTimersByTimeAsync(700);
         expect(read.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
         const port = arrive("slowRows");

         expect(port.posted("stream")).toHaveLength(0);
      });

      it("clears the timer when the connection closes", async () => {
         vi.useFakeTimers();
         const { api, arrive, closeFromMain } = await load();
         arrive("slowRows", "k1");
         const read = track(api.slowRows.stream("rows").next());

         closeFromMain("slowRows", "k1");
         await vi.advanceTimersByTimeAsync(0);

         expect(read.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("has no timer for a stream without the option, though the config has a default", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         arrive("plainRows");
         const read = track(api.plainRows.stream().next());

         await vi.advanceTimersByTimeAsync(1_000_000);

         expect(read.status).toBe("pending");
      });
   });
});
