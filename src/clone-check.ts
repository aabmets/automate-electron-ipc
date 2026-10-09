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

import type * as t from "@types";
import type { AstNode, Source } from "./ast.js";
import { forEachChild } from "./ast.js";
import type { TypeDeclarations } from "./module-bindings.js";

/** Global types that the structured clone algorithm rejects. */
const UNCLONABLE_GLOBALS = new Map([
   ["Function", "a function"],
   ["WeakMap", "a WeakMap"],
   ["WeakSet", "a WeakSet"],
]);

/**
 * Utility types whose result is not made of their type arguments as they are: they compute from
 * a function type, or they drop members and union branches, such as `Exclude<T, Function>`.
 * What they produce cannot be told without evaluating them, so their arguments are not checked.
 */
const CLONE_SKIPPED_ARGUMENTS = new Set([
   "Parameters",
   "ReturnType",
   "InstanceType",
   "ConstructorParameters",
   "Exclude",
   "Extract",
   "Omit",
   "Pick",
]);

/** Nodes that stand for no type that is sent: values, keys and patterns to match against. */
const CLONE_SKIPPED_NODES = new Set([
   "TsTypeQuery",
   "TsImportType",
   "TsInferType",
   "TsLiteralType",
   "TsTemplateLiteralType",
   "TsThisType",
   "TsTypePredicate",
   "TsSetterSignature",
]);

/**
 * The global thenable types. A `PromiseLike` is a Promise in practice, so it is allowed and reported
 * in the same places. The generated code treats it as a sync result that `invoke` awaits.
 */
const PROMISE_TYPES = new Set(["Promise", "PromiseLike"]);

/** The nodes through which a type is still the outermost type of the result. */
const CLONE_OUTERMOST_NODES = new Set(["TsParenthesizedType", "TsUnionType", "TsTypeReference"]);

const CLONE_FUNCTION_NODES = new Set([
   "TsFunctionType",
   "TsConstructorType",
   "TsMethodSignature",
   "TsCallSignatureDeclaration",
   "TsConstructSignatureDeclaration",
]);

export interface CloneWalk {
   src: Source;
   locals: ReadonlySet<string>;
   declarations: TypeDeclarations;
   /** `parameter 'x'` or `return type`, for the issues found. */
   where: string;
   /**
    * Whether a Promise is allowed at this place. Only the outermost type of a result may be one
    * (also in a union and behind a local alias), as that is what an async signature returns.
    * Electron cannot clone a Promise anywhere else.
    */
   promiseOk: boolean;
   /**
    * Whether the type is the argument of `Awaited<...>`, which unwraps a Promise or a `PromiseLike`
    * (and the one inside it) at the outermost position, so those are not reported. Like
    * `promiseOk`, it ends below an object, an array or a type argument.
    */
   awaited: boolean;
   /** The local types being followed, which guards against recursive types. */
   active: string[];
   /** The type parameters in scope, with their constraints. */
   scope: ReadonlyMap<string, AstNode | undefined>;
   issues: t.CloneIssue[];
}

function reportCloneIssue(
   walk: CloneWalk,
   level: t.CloneIssue["level"],
   node: AstNode,
   reason: string,
): void {
   const type = walk.src.text(node);
   const via = walk.active.length > 0 ? walk.active.join(" → ") : undefined;
   const issue: t.CloneIssue = { level, where: walk.where, type, reason, ...(via ? { via } : {}) };
   const key = JSON.stringify(issue);
   if (!walk.issues.some((other) => JSON.stringify(other) === key)) {
      walk.issues.push(issue);
   }
}

export function typeParamScope(
   node: AstNode,
   scope: ReadonlyMap<string, AstNode | undefined>,
): ReadonlyMap<string, AstNode | undefined> {
   const params: AstNode[] = node.typeParams?.parameters ?? [];
   if (params.length === 0) {
      return scope;
   }
   const result = new Map(scope);
   for (const param of params) {
      result.set(param.name.value, param.constraint);
   }
   return result;
}

/** Follows a reference to a type that the schema file declares. */
function walkLocalType(name: string, node: AstNode, walk: CloneWalk): void {
   const declarations = walk.declarations.get(name);
   if (!declarations || walk.active.includes(name)) {
      return;
   }
   for (const declaration of declarations) {
      if (declaration.type === "TsTypeAliasDeclaration") {
         const inner = {
            ...walk,
            active: [...walk.active, name],
            scope: typeParamScope(declaration, walk.scope),
         };
         walkCloneType(declaration.typeAnnotation, inner);
      } else if (declaration.type === "TsInterfaceDeclaration") {
         const inner = {
            ...walk,
            promiseOk: false,
            awaited: false,
            active: [...walk.active, name],
            scope: typeParamScope(declaration, walk.scope),
         };
         for (const member of declaration.body.body as AstNode[]) {
            walkCloneType(member, inner);
         }
         for (const parent of declaration.extends as AstNode[]) {
            if (parent.expression.type === "Identifier") {
               walkLocalType(parent.expression.value, parent, inner);
            }
         }
      } else {
         // Class instances are sent as plain objects: the prototype and the methods are lost.
         reportCloneIssue(walk, "warning", node, `an instance of the class '${name}'`);
      }
   }
}

function walkCloneReference(node: AstNode, walk: CloneWalk): void {
   const args: AstNode[] = node.typeParams?.params ?? [];
   // The arguments of a type are always below the result, so a Promise there is not the result.
   const below =
      walk.promiseOk || walk.awaited ? { ...walk, promiseOk: false, awaited: false } : walk;
   const walkArgs = (list: AstNode[]) => {
      for (const arg of list) {
         walkCloneType(arg, below);
      }
   };
   if (node.typeName.type !== "Identifier") {
      // A qualified name such as `Models.User` cannot be resolved without its module.
      walkArgs(args);
      return;
   }
   const name: string = node.typeName.value;
   if (walk.scope.has(name)) {
      const constraint = walk.scope.get(name);
      const outer = new Map(walk.scope);
      outer.delete(name);
      walkCloneType(constraint, { ...below, scope: outer });
   } else if (walk.locals.has(name)) {
      walkArgs(args);
      // An alias of a Promise is still the outermost type of the result, when the alias is.
      walkLocalType(name, node, args.length === 0 ? walk : below);
   } else if (UNCLONABLE_GLOBALS.has(name)) {
      reportCloneIssue(walk, "error", node, UNCLONABLE_GLOBALS.get(name) as string);
   } else if (name === "Awaited" && args.length === 1) {
      // `Awaited<Promise<X>>` is `X`: it unwraps the thenables at its outermost position.
      walkCloneType(args[0], { ...walk, promiseOk: false, awaited: true });
   } else if (PROMISE_TYPES.has(name)) {
      if (walk.awaited) {
         // The thenable is unwrapped, so what it resolves to is what is sent, and may be a thenable.
         walkCloneType(args[0], { ...walk, promiseOk: false });
      } else if (walk.promiseOk) {
         walkArgs(args);
      } else {
         reportCloneIssue(walk, "error", node, "a Promise");
      }
   } else if (!CLONE_SKIPPED_ARGUMENTS.has(name)) {
      walkArgs(args);
   }
}

/**
 * Collects what the structured clone algorithm cannot send from a type, including the members
 * of object types, arrays, tuples, unions, type arguments and the local types it refers to.
 */
export function walkCloneType(node: AstNode | undefined, walk: CloneWalk): void {
   if (!node || CLONE_SKIPPED_NODES.has(node.type)) {
      return;
   }
   // Only these keep the outermost position of the result, a reference decides for itself.
   if ((walk.promiseOk || walk.awaited) && !CLONE_OUTERMOST_NODES.has(node.type)) {
      walk = { ...walk, promiseOk: false, awaited: false };
   }
   if (CLONE_FUNCTION_NODES.has(node.type)) {
      reportCloneIssue(walk, "error", node, "a function");
   } else if (node.type === "TsKeywordType") {
      if (node.kind === "symbol") {
         reportCloneIssue(walk, "error", node, "a symbol");
      }
   } else if (node.type === "TsTypeOperator") {
      if (node.op === "unique") {
         reportCloneIssue(walk, "error", node, "a symbol");
      } else if (node.op !== "keyof") {
         walkCloneType(node.typeAnnotation, walk);
      }
   } else if (node.type === "TsTypeReference") {
      walkCloneReference(node, walk);
   } else if (node.type === "TsConditionalType") {
      // The checked and `extends` types only select a branch.
      walkCloneType(node.trueType, walk);
      walkCloneType(node.falseType, walk);
   } else if (node.type === "TsIndexedAccessType") {
      walkCloneType(node.objectType, walk);
   } else if (
      ["TsPropertySignature", "TsGetterSignature", "TsIndexSignature"].includes(node.type)
   ) {
      walkCloneType(node.typeAnnotation?.typeAnnotation, walk);
   } else {
      forEachChild(node, (child) => walkCloneType(child, walk));
   }
}
