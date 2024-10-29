/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import * as utils from "./utils";

export interface IPCParams {
   name: string;
   type: string;
}

export interface IPCFunction {
   name: string;
   params: IPCParams[];
   returnType: string;
   customTypes: string[];
}

const builtinTypes = new Set(["string", "number", "boolean", "void", "unknown", "any"]);

export function getFunctionSignatureRegex(): RegExp {
   return utils.concatRegex(
      [
         /export\s+function\s+/,
         /([a-zA-Z0-9_]+)\s*\(/,
         /([^)]*)\)\s*/,
         /(:\s*([a-zA-Z0-9_\[\]\s<>,]+))?/,
      ],
      "g",
   );
}

export function extractReturnType(match: RegExpExecArray): {
   returnType: string;
   customTypes: Set<string>;
} {
   const returnType = match[4] ? match[4].trim() : "void";
   const customTypes = new Set<string>();

   if (returnType && !builtinTypes.has(returnType)) {
      customTypes.add(returnType);
   }
   return { returnType, customTypes };
}

export function parseObjectExpansionParam(param: string, customTypes: Set<string>): IPCParams {
   const innerParam = param.slice(1, -1).trim();
   const name = "";
   let type: string;

   if (innerParam.includes(":")) {
      const [key, value] = innerParam.split(":").map((part) => part.trim());
      type = `{ ${key}: ${value} }`;

      if (value && !builtinTypes.has(value)) {
         customTypes.add(value);
      }
   } else {
      type = `{ ${innerParam}: unknown }`;
   }
   return { name, type };
}

export function parseExpandedObjectParam(param: string, customTypes: Set<string>): IPCParams {
   const name = "";
   const type = param.replace("...", "").trim() || "unknown";

   if (!builtinTypes.has(type)) {
      customTypes.add(type);
   }
   return { name, type };
}

export function parseSimpleParam(param: string, customTypes: Set<string>): IPCParams {
   const [namePart, ...typeParts] = param.split(":");
   const name = namePart.trim();
   const type = typeParts.join(":").trim() || "unknown";
   const cleanedType = type.replace(/[\[\]]/g, "");

   if (cleanedType && !builtinTypes.has(cleanedType) && !type.startsWith("{")) {
      customTypes.add(cleanedType);
   }
   return { name, type };
}

export function parseParam(param: string, customTypes: Set<string>): IPCParams {
   const p = param.trim();
   if (p.startsWith("{") && p.endsWith("}")) {
      return parseObjectExpansionParam(p, customTypes);
   } else if (p.startsWith("...")) {
      return parseExpandedObjectParam(p, customTypes);
   } else {
      return parseSimpleParam(p, customTypes);
   }
}

export function extractFunctionParams(parameters: string, customTypes: Set<string>): IPCParams[] {
   return parameters
      .split(",")
      .map((param) => parseParam(param, customTypes))
      .filter((param) => param.name.length > 0 || param.type !== "unknown");
}

export function extractFunctionSignatures(fileContent: string): IPCFunction[] {
   const functionSignatureRegex = getFunctionSignatureRegex();
   const functions: IPCFunction[] = [];
   let match: RegExpExecArray | null = functionSignatureRegex.exec(fileContent);

   while (match !== null) {
      const functionName = match[1];
      const parameters = match[2];
      const { returnType, customTypes } = extractReturnType(match);
      const params = extractFunctionParams(parameters, customTypes);

      functions.push({
         name: functionName,
         params,
         returnType,
         customTypes: Array.from(customTypes),
      });
      match = functionSignatureRegex.exec(fileContent);
   }
   return functions;
}

export default {
   getFunctionSignatureRegex,
   extractReturnType,
   parseObjectExpansionParam,
   parseExpandedObjectParam,
   parseSimpleParam,
   parseParam,
   extractFunctionParams,
   extractFunctionSignatures,
};
