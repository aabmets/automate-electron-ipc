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

/**
 * Replaces the type names of a text of a signature, such as `User` with `User_2`, and the
 * specifiers of its import types with the ones that `rebase` gives. `refs` are the type
 * references of the whole definition, which the parser took from the AST, and `offset` is
 * the position in the definition where `text` starts. Only the references inside the text are
 * replaced, so names of members, string literals, property keys and parameters stay as written.
 */
function renameTypeReferences(
   text: string,
   offset: number,
   refs: readonly t.TypeRef[],
   renames: ReadonlyMap<string, string>,
   rebase: (importPath: string) => string,
): string {
   let result = "";
   let last = 0;
   for (const ref of refs) {
      const renamed =
         ref.importPath === undefined
            ? renames.get(ref.name)
            : JSON.stringify(rebase(ref.importPath));
      if (renamed !== undefined && ref.start >= offset + last && ref.end <= offset + text.length) {
         result += text.slice(last, ref.start - offset) + renamed;
         last = ref.end - offset;
      }
   }
   return result + text.slice(last);
}

/**
 * The channel specs of a schema file, with the type names of their signatures replaced by
 * the names that the generated imports declare (see `ImportsGenerator.getRenames`).
 * `rebase` gives the specifier of an import type as written from the generated file.
 */
export function renameChannelSpecs(
   specs: t.ChannelSpec[],
   renames: ReadonlyMap<string, string>,
   rebase: (importPath: string) => string,
): t.ChannelSpec[] {
   const hasImportTypes = (refs: readonly t.TypeRef[] | undefined) =>
      !!refs?.some((ref) => ref.importPath !== undefined);
   if (
      renames.size === 0 &&
      !specs.some(
         (spec) => hasImportTypes(spec.signature.typeRefs) || hasImportTypes(spec.errors?.typeRefs),
      )
   ) {
      return specs;
   }
   return specs.map((spec) => {
      const { definition, paramsStart, returnType, returnStart, params, chunkType, chunkStart } =
         spec.signature;
      const refs = spec.signature.typeRefs ?? [];
      const rename = (text: string, offset: number | undefined) =>
         offset === undefined ? text : renameTypeReferences(text, offset, refs, renames, rebase);
      const errors = spec.errors && {
         ...spec.errors,
         definition: renameTypeReferences(
            spec.errors.definition,
            0,
            spec.errors.typeRefs ?? [],
            renames,
            rebase,
         ),
         typeRefs: [],
      };
      return {
         ...spec,
         ...(errors ? { errors } : {}),
         signature: {
            ...spec.signature,
            definition: rename(definition, 0),
            // Renaming changes the length of the text before the parameter list.
            paramsStart: rename(definition.slice(0, paramsStart), 0).length,
            returnType: rename(returnType, returnStart),
            ...(chunkType === undefined ? {} : { chunkType: rename(chunkType, chunkStart) }),
            params: params.map((param) => ({
               ...param,
               type: rename(param.type, param.typeStart),
            })),
            // The offsets of the references refer to the text before the renaming.
            typeRefs: [],
         },
      };
   });
}
