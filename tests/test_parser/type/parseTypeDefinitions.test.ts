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
   describe("TypeAliasDeclarations", () => {
      it("should correctly parse an exported type alias", () => {
         const result = parseTypeDefinitions(`
            export type ID = string | number;
         `);
         expect(result).toStrictEqual([
            {
               name: "ID",
               kind: "type",
               generics: null,
               isExported: true,
            },
         ]);
      });

      it("should correctly parse a non-exported type alias", () => {
         const result = parseTypeDefinitions(`
            type Coordinates = {
               x: number;
               y: number;
            };
         `);
         expect(result).toStrictEqual([
            {
               name: "Coordinates",
               kind: "type",
               generics: null,
               isExported: false,
            },
         ]);
      });

      it("should correctly parse a type alias with multiple modifiers", () => {
         const result = parseTypeDefinitions(`
            export declare type Status = "active" | "inactive";
         `);
         expect(result).toStrictEqual([
            {
               name: "Status",
               kind: "type",
               generics: null,
               isExported: true,
            },
         ]);
      });

      it("should handle type aliases with generics", () => {
         const result = parseTypeDefinitions(`
            export type ApiResponse<T> = {
               success: boolean;
               payload: T;
            };
         `);
         expect(result).toStrictEqual([
            {
               name: "ApiResponse",
               kind: "type",
               generics: "<T>",
               isExported: true,
            },
         ]);
      });

      it("should handle type aliases with union and intersection types", () => {
         const result = parseTypeDefinitions(`
            export type Result = Success | Failure & ErrorInfo;
         `);
         expect(result).toStrictEqual([
            {
               name: "Result",
               kind: "type",
               generics: null,
               isExported: true,
            },
         ]);
      });
   });

   describe("Edge Cases", () => {
      it("should return an empty array for empty source code", () => {
         expect(parseTypeDefinitions("")).toStrictEqual([]);
      });

      it("should return an empty array when there are no type definitions", () => {
         const result = parseTypeDefinitions(`
            const x = 10;
            function greet() {
               console.log("Hello, World!");
            }
         `);
         expect(result).toStrictEqual([]);
      });

      it("should handle type definitions with comments and extra whitespace", () => {
         const result = parseTypeDefinitions(`
            // Exported interface with comments
            export interface User {
               // User ID
               id: number; // Numeric ID

               /**
                * User's full name
                */
               name: string;
            }

            /* Non-exported type alias with comments */
            type Coordinates = {
               x: number; // X-axis
               y: number; // Y-axis
            };
         `);
         expect(result).toEqual([
            {
               name: "User",
               kind: "interface",
               generics: null,
               isExported: true,
            },
            {
               name: "Coordinates",
               kind: "type",
               generics: null,
               isExported: false,
            },
         ]);
      });

      it("should handle type definitions with excessive whitespace", () => {
         const code = `
            export    interface    User<T>    {
               id    :    number;
               name    :    string;
               arg     :    T;
            }

            type    Point    =    {
               x    :    number;
               y    :    number;
            };
         `;
         const result = parseTypeDefinitions(code);
         expect(result).toEqual([
            {
               name: "User",
               kind: "interface",
               generics: "<T>",
               isExported: true,
            },
            {
               name: "Point",
               kind: "type",
               generics: null,
               isExported: false,
            },
         ]);
      });

      it("should handle type definitions with different naming conventions", () => {
         const result = parseTypeDefinitions(`
            export interface userProfile {
               user_id: number;
               user_name: string;
            }
            type USER_STATUS = "active" | "inactive";
         `);
         expect(result).toEqual([
            {
               name: "userProfile",
               kind: "interface",
               generics: null,
               isExported: true,
            },
            {
               name: "USER_STATUS",
               kind: "type",
               generics: null,
               isExported: false,
            },
         ]);
      });
   });
});
