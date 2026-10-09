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

import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import utils from "@src/utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
});

describe("isCaseInsensitiveFileSystem", () => {
   afterEach(vi.restoreAllMocks);

   const stats = (ino: number, dev = 1) => ({ ino: BigInt(ino), dev: BigInt(dev) });

   /** Mocks `fsp.stat` so that only the given paths exist, each with its identity. */
   function mockStat(entries: Record<string, ReturnType<typeof stats>>) {
      return vi.spyOn(fsp, "stat").mockImplementation(((target: string) => {
         const found = entries[String(target).replaceAll("\\", "/")];
         return found === undefined
            ? Promise.reject(Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" }))
            : Promise.resolve(found);
      }) as never);
   }

   it("is true when the name with swapped case finds the same directory", async () => {
      mockStat({ "/proj/src/ipc": stats(7), "/proj/src/IPC": stats(7) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(true);
   });

   it("is false when the name with swapped case finds nothing", async () => {
      mockStat({ "/proj/src/ipc": stats(7) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(false);
   });

   it("is false when the name with swapped case finds another directory", async () => {
      mockStat({ "/proj/src/ipc": stats(7), "/proj/src/IPC": stats(8) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(false);
      vi.restoreAllMocks();
      mockStat({ "/proj/src/ipc": stats(7, 1), "/proj/src/IPC": stats(7, 2) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(false);
   });

   it("probes the nearest existing ancestor of a directory that does not exist", async () => {
      const spy = mockStat({ "/proj/src": stats(3), "/proj/SRC": stats(3) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc/deeper")).resolves.toBe(true);
      expect(spy).toHaveBeenCalledWith("/proj/SRC", { bigint: true });
   });

   it("skips a name without letters", async () => {
      mockStat({ "/proj/src/1234": stats(9), "/proj/src": stats(3), "/proj/SRC": stats(3) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/1234")).resolves.toBe(true);
   });

   it("is false when no directory of the path exists", async () => {
      mockStat({});
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src")).resolves.toBe(false);
   });

   it("writes nothing", async () => {
      const root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-utils-case-"));
      try {
         await fsp.mkdir(path.join(root, "ipc"));
         const before = await fsp.readdir(root);
         const result = await utils.isCaseInsensitiveFileSystem(path.join(root, "ipc"));
         expect(typeof result).toBe("boolean");
         expect(await fsp.readdir(root)).toStrictEqual(before);
         expect(await fsp.readdir(path.join(root, "ipc"))).toStrictEqual([]);
      } finally {
         await fsp.rm(root, { recursive: true, force: true });
      }
   });
});

describe("isPathInside", () => {
   it("should return true when childPath is directly inside parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/user/documents/file.txt";
      expect(utils.isPathInside(childPath, parentPath)).toBe(true);
   });

   it("should return false when childPath is outside of parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/otherUser/documents/file.txt";
      expect(utils.isPathInside(childPath, parentPath)).toBe(false);
   });

   it("should return false when childPath is the same as parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/user";
      expect(utils.isPathInside(childPath, parentPath)).toBe(false);
   });

   it("should handle relative paths correctly", () => {
      const parentPath = "/home/user";
      const childPath = path.join(parentPath, "../user2/documents/file.txt");
      expect(utils.isPathInside(childPath, parentPath)).toBe(false);
   });

   it("should return true for nested directories within the parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/user/documents/subdir/file.txt";
      expect(utils.isPathInside(childPath, parentPath)).toBe(true);
   });

   it("should work with different path separators (cross-platform)", () => {
      const parentPath = path.join("home", "user");
      const childPath = path.join("home", "user", "documents", "file.txt");
      expect(utils.isPathInside(childPath, parentPath)).toBe(true);
   });
});

describe("isSchemaSourceFile", () => {
   it.each(["schema.ts", "a/b/schema.mts", "x.cts", "dir.v2/user.model.ts", "a.d.tsx.ts"])(
      "accepts %s",
      (name) => {
         expect(utils.isSchemaSourceFile(name)).toBe(true);
      },
   );

   it.each([
      "legacy.d.ts",
      "legacy.d.mts",
      "legacy.d.cts",
      "dir/types.d.ts",
      "README.md",
      "data.json",
      "script.js",
      "component.tsx",
      "ts",
      "schema.ts.bak",
   ])("rejects %s", (name) => {
      expect(utils.isSchemaSourceFile(name)).toBe(false);
   });
});
