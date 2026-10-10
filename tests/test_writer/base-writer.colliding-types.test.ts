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

import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestBaseWriter } from "@testutils/writer/test-writers.js";
import { parseTestSignature } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("BaseWriter", () => {
   mockGetTargetFilePath(VitestBaseWriter);

   describe("channel specs of colliding type names", () => {
      const pfsOf = (fullPath: string, definition: string): t.ParsedFileSpecs => ({
         fullPath,
         relativePath: "",
         specs: {
            channelSpecArray: [
               {
                  name: "chan",
                  signature: parseTestSignature(definition),
               } as unknown as t.ChannelSpec,
            ],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [
               { name: "User", kind: "interface" as t.TypeKind, generics: null, isExported: true },
            ],
         },
      });
      const first = pfsOf("/project/a.ts", "() => User");
      const renamed = (definition: string) => {
         const second = pfsOf("/project/b.ts", definition);
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);
         // The first file takes the name `User`, so the second one is renamed.
         obj.getChannelSpecs(first);
         return obj.getChannelSpecs(second)[0].signature;
      };

      it("should return the specs as they are when no type name is taken", () => {
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [first]);
         expect(obj.getChannelSpecs(first)).toBe(first.specs.channelSpecArray);
      });

      it("should rename the references of the colliding type in the signature", () => {
         const definition =
            "(User: User, list?: Map<string, User>, o: { User: User; readonly User: User }, " +
            's: "User", n: NS.User, c: A extends B ? User : User[]) => Promise<User[]>';
         const second = pfsOf("/project/b.ts", definition);
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);

         expect(obj.getChannelSpecs(first)).toBe(first.specs.channelSpecArray);
         const [spec] = obj.getChannelSpecs(second);
         expect(spec.signature.definition).toStrictEqual(
            "(User: User_2, list?: Map<string, User_2>, o: { User: User_2; readonly User: User_2 }, " +
               's: "User", n: NS.User, c: A extends B ? User_2 : User_2[]) => Promise<User_2[]>',
         );
         expect(spec.signature.returnType).toStrictEqual("Promise<User_2[]>");
         expect(spec.signature.params.slice(0, 2)).toMatchObject([
            { name: "User", type: "User_2", rest: false, optional: false },
            { name: "list", type: "Map<string, User_2>", rest: false, optional: true },
         ]);
         expect(spec.signature.params[3].type).toStrictEqual('"User"');
         expect(spec.signature.customTypes).toStrictEqual(["User", "NS.User", "A", "B"]);
         // The parsed spec is not modified.
         expect(second.specs.channelSpecArray[0].signature.returnType).toStrictEqual(
            "Promise<User[]>",
         );
      });

      it("should rename the references in the chunk type of a stream signature", () => {
         const second = pfsOf("/project/b.ts", "() => AsyncIterable<User>");
         const spec = second.specs.channelSpecArray[0];
         spec.signature = parseTestSignature("() => AsyncIterable<User>", [], true);
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);
         obj.getChannelSpecs(first);
         const { signature } = obj.getChannelSpecs(second)[0];

         expect(signature.definition).toBe("() => AsyncIterable<User_2>");
         expect(signature.returnType).toBe("AsyncIterable<User_2>");
         expect(signature.chunkType).toBe("User_2");
         // The parsed spec is not modified.
         expect(spec.signature.chunkType).toBe("User");
      });

      // The `${...}` part of a template literal type was skipped as a string.
      it("should rename a reference inside a template literal type", () => {
         const signature = renamed("(key: `k-${User}`, u: User) => `${User}-v`");
         expect(signature.definition).toBe("(key: `k-${User_2}`, u: User_2) => `${User_2}-v`");
         expect(signature.params[0].type).toBe("`k-${User_2}`");
         expect(signature.returnType).toBe("`${User_2}-v`");
      });

      it("should not rename the text of a template literal outside of `${}`", () => {
         expect(renamed("(key: `User-${User}-User`) => void").definition).toBe(
            "(key: `User-${User_2}-User`) => void",
         );
      });

      // The member name of a method type was renamed.
      it("should not rename the name of a method or an accessor", () => {
         const signature = renamed("(o: { User(): User; get User(): User; User?: User }) => void");
         expect(signature.definition).toBe(
            "(o: { User(): User_2; get User(): User_2; User?: User_2 }) => void",
         );
      });

      it("should rename a type in the type parameters and shift the start of the parameters", () => {
         const signature = renamed("<T extends User = User>(a: T) => T");
         expect(signature.definition).toBe("<T extends User_2 = User_2>(a: T) => T");
         expect(signature.definition.slice(signature.paramsStart)).toBe("a: T) => T");
      });

      it("should rename the head of a qualified name and a typeof query, not the rest", () => {
         const signature = renamed("(a: User.Kind, b: typeof User, c: typeof User.value) => void");
         expect(signature.definition).toBe(
            "(a: User_2.Kind, b: typeof User_2, c: typeof User_2.value) => void",
         );
      });

      it("should not rename a type parameter that shadows the colliding type", () => {
         const signature = renamed("<User>(a: User) => User");
         expect(signature.definition).toBe("<User>(a: User) => User");
      });

      it("should leave the texts alone for a signature without the offsets of the parser", () => {
         const second = pfsOf("/project/b.ts", "(a: User) => User");
         const {
            typeRefs: _refs,
            returnStart: _r,
            ...bare
         } = second.specs.channelSpecArray[0].signature;
         bare.params = bare.params.map(({ typeStart: _t, ...param }) => param);
         second.specs.channelSpecArray[0].signature = bare;
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);
         obj.getChannelSpecs(first);
         expect(obj.getChannelSpecs(second)[0].signature).toMatchObject({
            returnType: "User",
            params: [{ type: "User" }],
         });
      });

      it("should rename correctly after non-ASCII text", () => {
         const signature = renamed('(k: "é日本", a: User) => User');
         expect(signature.definition).toBe('(k: "é日本", a: User_2) => User_2');
         expect(signature.params[1].type).toBe("User_2");
         expect(signature.returnType).toBe("User_2");
      });
   });

   // The path of an import type is relative to the schema file, and was
   // copied as it is into the generated files.
   describe("import types in signatures", () => {
      class InIpcDir extends VitestBaseWriter {
         public getTargetFilePath(): string {
            return "/project/ipc/main.ts";
         }
      }
      const channelsOf = (fullPath: string, definition: string, nodeNext = false) => {
         const pfs: t.ParsedFileSpecs = {
            fullPath,
            relativePath: "",
            specs: {
               channelSpecArray: [
                  {
                     name: "chan",
                     signature: parseTestSignature(definition),
                  } as unknown as t.ChannelSpec,
               ],
               channelMapExport: null,
               importSpecArray: [],
               typeSpecArray: [],
            },
         };
         const config = { projectUsesNodeNext: nodeNext } as t.IPCResolvedConfig;
         return new InIpcDir(config, [pfs]).getChannelSpecs(pfs)[0].signature;
      };

      it("should rebase the path to the directory of the generated file", () => {
         const signature = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("./models").User) => Promise<typeof import("../shared/x.mjs")>',
         );
         expect(signature.definition).toBe(
            '(a: import("./schema/models").User) => Promise<typeof import("./shared/x.mjs")>',
         );
         expect(signature.params[0].type).toBe('import("./schema/models").User');
         expect(signature.returnType).toBe('Promise<typeof import("./shared/x.mjs")>');
         expect(signature.definition.slice(signature.paramsStart)).toBe(
            'a: import("./schema/models").User) => Promise<typeof import("./shared/x.mjs")>',
         );
      });

      it("should add the script extension for NodeNext", () => {
         const signature = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("./models").User, b: import("./data.json")) => void',
            true,
         );
         expect(signature.definition).toBe(
            '(a: import("./schema/models.js").User, b: import("./schema/data.json")) => void',
         );
      });

      it("should keep the specifier of a package", () => {
         const spec = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("zod").ZodType) => void',
         );
         expect(spec.definition).toBe('(a: import("zod").ZodType) => void');
      });

      it("should rebase the path in the type arguments of an import type", () => {
         const signature = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("./a").Box<import("./b").Item>) => void',
         );
         expect(signature.definition).toBe(
            '(a: import("./schema/a").Box<import("./schema/b").Item>) => void',
         );
      });
   });
});
