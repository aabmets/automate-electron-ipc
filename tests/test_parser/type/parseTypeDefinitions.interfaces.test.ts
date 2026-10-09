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

import { parseTypeDefinitions } from "@testutils/parser/type-definitions-utils.js";
import { describe, expect, it } from "vitest";

describe("parseTypeDefinitions", () => {
   describe("InterfaceDeclarations", () => {
      it("should correctly parse an exported interface", () => {
         const result = parseTypeDefinitions(`
            export interface User {
               id: number;
               name: string;
            }
         `);
         expect(result).toStrictEqual([
            {
               name: "User",
               kind: "interface",
               generics: null,
               isExported: true,
            },
         ]);
      });

      it("should correctly parse a non-exported interface", () => {
         const result = parseTypeDefinitions(`
            interface Product {
               id: number;
               title: string;
            }
         `);
         expect(result).toStrictEqual([
            {
               name: "Product",
               kind: "interface",
               generics: null,
               isExported: false,
            },
         ]);
      });

      it("should correctly parse an interface with multiple modifiers", () => {
         const result = parseTypeDefinitions(`
            export declare interface Config {
               debug: boolean;
               version: string;
            }
         `);
         expect(result).toStrictEqual([
            {
               name: "Config",
               kind: "interface",
               generics: null,
               isExported: true,
            },
         ]);
      });

      it("should handle interfaces with generics", () => {
         const result = parseTypeDefinitions(`
            export interface Response<T> {
               data: T;
               error?: string;
            }
         `);
         expect(result).toStrictEqual([
            {
               name: "Response",
               kind: "interface",
               generics: "<T>",
               isExported: true,
            },
         ]);
      });

      it("should mark a default exported interface", () => {
         const result = parseTypeDefinitions(`
            export default interface Payload {
               id: number;
            }
         `);
         expect(result).toStrictEqual([
            {
               name: "Payload",
               kind: "interface",
               generics: null,
               isExported: true,
               isDefault: true,
            },
         ]);
      });

      it("should handle interfaces with inheritance", () => {
         const result = parseTypeDefinitions(`
            export interface Admin extends User {
               adminLevel: number;
            }
         `);
         expect(result).toStrictEqual([
            {
               name: "Admin",
               kind: "interface",
               generics: null,
               isExported: true,
            },
         ]);
      });
   });
});
