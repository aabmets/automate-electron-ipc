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

import parser from "@src/parser";
import * as t from "@types";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function parseTypeDefinitions(code: string): t.TypeSpec[] {
   const src = ts.createSourceFile("temp.ts", code, ts.ScriptTarget.Latest, true);
   const specs: t.TypeSpec[] = [];
   ts.forEachChild(src, (node: ts.Node) => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
         parser.parseTypeDefinitions(node, src, specs);
      }
   });
   return specs;
}

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
         const result = parseTypeDefinitions("");
         expect(result).toStrictEqual([]);
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
