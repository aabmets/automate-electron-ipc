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

// Sender validation and argument validation against the real `senderFrame` of Electron. The pages
// are served from the custom `app://` scheme, so a page and its iframe can have different origins.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const forbidden = { name: "IpcForbiddenError", code: "IPC_FORBIDDEN" };

const scenarios: Record<string, Scenario> = {
   allowedOrigin: async (ctx) => {
      const win = await ctx.open({ url: "app://main/index.html" });
      const notes: unknown[] = [];
      ctx.ipc.secret.handle(async (_event: unknown, id: number) => `secret ${id}`);
      ctx.ipc.note.on((_event: unknown, text: string) => notes.push(text));
      const value = await ctx.evaluate(win, () => ipc.secret.invoke(1));
      await ctx.evaluate(win, () => ipc.note.send("from main"));
      await ctx.waitFor(() => notes.length === 1);
      return { value, notes };
   },

   otherOrigin: async (ctx) => {
      const win = await ctx.open({ url: "app://other/index.html" });
      const notes: unknown[] = [];
      let handled = 0;
      ctx.ipc.secret.handle(async () => {
         handled++;
         return "secret";
      });
      ctx.ipc.note.on((_event: unknown, text: string) => notes.push(text));
      ctx.ipc.open.handle(async () => "open");
      const error = await ctx.evaluate(win, async () => {
         try {
            await ipc.secret.invoke(1);
            return null;
         } catch (cause: any) {
            return { name: cause.name, code: cause.code, message: cause.message };
         }
      });
      await ctx.evaluate(win, () => ipc.note.send("from other"));
      // A call which is not restricted shows that the dropped message had time to arrive.
      const open = await ctx.evaluate(win, () => ipc.open.invoke(1));
      await ctx.sleep(100);
      return { error, handled, notes, open };
   },

   iframe: async (ctx) => {
      ctx.serve("app://main/index.html", '<iframe src="app://other/frame.html"></iframe>');
      ctx.serve("app://other/frame.html", "<p>frame</p>");
      const win = await ctx.open({ subframes: true });
      const frame = win.webContents.mainFrame.frames[0];
      ctx.ipc.secret.handle(async () => "secret");
      ctx.ipc.open.handle(async () => "open");
      const call = (target: unknown) =>
         ctx.evaluate(target, async () => {
            const outcome: Record<string, unknown> = { origin: location.origin };
            for (const name of ["secret", "open"] as const) {
               try {
                  outcome[name] = await ipc[name].invoke(1);
               } catch (cause: any) {
                  outcome[name] = { name: cause.name, code: cause.code };
               }
            }
            return outcome;
         });
      return { frameOrigin: frame.origin, main: await call(win), frame: await call(frame) };
   },

   validateSender: async (ctx) => {
      ctx.serve("app://main/index.html", '<iframe src="app://other/frame.html"></iframe>');
      ctx.serve("app://other/frame.html", "<p>frame</p>");
      const win = await ctx.open({ subframes: true });
      const frame = win.webContents.mainFrame.frames[0];
      const seen: unknown[] = [];
      const rejected: unknown[] = [];
      ctx.main.configureIpc({
         validateSender: (event: any, channel: string) => {
            seen.push({ channel, origin: event.senderFrame.origin, url: event.senderFrame.url });
            return event.senderFrame.origin === "app://main";
         },
         onRejected: (event: any, channel: string) =>
            rejected.push({ channel, origin: event.senderFrame.origin }),
      });
      ctx.ipc.open.handle(async () => "open");
      const call = (target: unknown) =>
         ctx.evaluate(target, async () => {
            try {
               return { value: await ipc.open.invoke(1) };
            } catch (cause: any) {
               return { name: cause.name, code: cause.code };
            }
         });
      const fromMain = await call(win);
      const fromFrame = await call(frame);
      return { fromMain, fromFrame, seen, rejected };
   },

   validateInvoke: async (ctx) => {
      const win = await ctx.open();
      const received: unknown[][] = [];
      const rejected: unknown[] = [];
      ctx.main.configureIpc({
         onRejected: (_event: unknown, channel: string, error: any) =>
            rejected.push({ channel, name: error?.name }),
      });
      ctx.ipc.checked.handle(async (_event: unknown, ...args: unknown[]) => {
         received.push(args);
         return "ok";
      });
      const attempt = (args: unknown[]) =>
         ctx.evaluate(
            win,
            async (list: unknown[]) => {
               try {
                  return { value: await ipc.checked.invoke(...list) };
               } catch (cause: any) {
                  return {
                     name: cause.name,
                     code: cause.code,
                     message: cause.message,
                     data: cause.data,
                  };
               }
            },
            args,
         );
      return {
         valid: await attempt([5]),
         wrongType: await attempt(["5"]),
         wrongCount: await attempt([1, 2]),
         received,
         rejected,
      };
   },

   validateSend: async (ctx) => {
      const win = await ctx.open();
      const received: unknown[][] = [];
      const rejected: unknown[] = [];
      ctx.main.configureIpc({
         onRejected: (_event: unknown, channel: string, error: any) =>
            rejected.push({ channel, name: error?.name }),
      });
      ctx.ipc.checkedSend.on((_event: unknown, ...args: unknown[]) => received.push(args));
      await ctx.evaluate(win, () => {
         ipc.checkedSend.send("bad");
         ipc.checkedSend.send(1);
      });
      await ctx.waitFor(() => received.length === 1 && rejected.length === 1, "the valid message");
      return { received, rejected };
   },
};

describeElectron("guards in Electron", "electron-guards", scenarios, (group) => {
   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   describe("allowedOrigins", () => {
      it("lets the page of an allowed origin call an invoke and send channel", () => {
         expect(group.value("allowedOrigin")).toStrictEqual({
            value: "secret 1",
            notes: ["from main"],
         });
      });

      it("rejects an invoke, and drops a send, from another origin", () => {
         const { error, handled, notes, open } = group.value("otherOrigin");
         expect(error).toMatchObject(forbidden);
         expect(error.message).toContain("'secret'");
         expect(handled).toBe(0);
         expect(notes).toStrictEqual([]);
         expect(open).toBe("open");
      });

      it("tells the main frame from an iframe of another origin by its senderFrame", () => {
         expect(group.value("iframe")).toStrictEqual({
            frameOrigin: "app://other",
            main: { origin: "app://main", secret: "secret", open: "open" },
            frame: { origin: "app://other", secret: forbidden, open: "open" },
         });
      });
   });

   describe("validateSender", () => {
      it("gets the real sender frame, and rejects the iframe of another origin", () => {
         const result = group.value("validateSender");
         expect(result.fromMain).toStrictEqual({ value: "open" });
         expect(result.fromFrame).toStrictEqual(forbidden);
         expect(result.seen).toStrictEqual([
            { channel: "open", origin: "app://main", url: "app://main/index.html" },
            { channel: "open", origin: "app://other", url: "app://other/frame.html" },
         ]);
         expect(result.rejected).toStrictEqual([{ channel: "open", origin: "app://other" }]);
      });
   });

   describe("validate", () => {
      it("runs the handler of an invoke channel only for valid arguments", () => {
         const result = group.value("validateInvoke");
         expect(result.valid).toStrictEqual({ value: "ok" });
         expect(result.received).toStrictEqual([[5]]);
      });

      it("rejects invalid arguments with the issues, and tells onRejected", () => {
         const result = group.value("validateInvoke");
         for (const attempt of [result.wrongType, result.wrongCount]) {
            expect(attempt).toMatchObject({
               name: "IpcValidationError",
               code: "IPC_VALIDATION",
               data: [{ message: "expected one number", path: [0] }],
            });
            expect(attempt.message).toContain("The arguments of the channel 'checked' are invalid");
         }
         expect(result.rejected).toStrictEqual([
            { channel: "checked", name: "IpcValidationError" },
            { channel: "checked", name: "IpcValidationError" },
         ]);
      });

      it("drops a send with invalid arguments, and tells onRejected", () => {
         const result = group.value("validateSend");
         expect(result.received).toStrictEqual([[1]]);
         expect(result.rejected).toStrictEqual([
            { channel: "checkedSend", name: "IpcValidationError" },
         ]);
      });
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-guards");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
