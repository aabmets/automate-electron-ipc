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

/**
 * The shared helpers of the generated files that a schema may not use. The writers emit them as
 * a whole, since which of them a file needs depends on the mix of channels, and a file that
 * declares one which nothing calls fails `noUnusedLocals` (T173). `pruneUnusedHelpers` takes the
 * unused ones out. A name of another declaration is never touched, so the list holds only the
 * names that the files reserve (see the `getReservedNames` of the writers).
 */
const HELPERS = new Set([
   // The protocol between the main process and a utility process (`buildUtilityPeer`).
   "lastUtilityCallId",
   "closeUtilityPeer",
   "callUtilityPeer",
   "sendUtilityPeer",
   "setUtilityHandler",
   "addUtilityListener",
   "callUtilityChild",
   // The registration of the handlers of the pages (`buildBrokerServer`).
   "setBrokerCall",
   "setBrokerStream",
   // The serializer (`buildSerializerRuntime` and `buildSerializerComponents`).
   "serializationError",
   "encodeValue",
   "encodeSync",
   "decodeValue",
   "decodeArguments",
   "readArguments",
   "readSentArguments",
   // The envelope of the answers.
   "IpcEnvelope",
]);

/** The imports of the serializer, which are unused once the helpers that call it are gone. */
const SERIALIZER_NAMES = ["ipcSerialize", "ipcDeserialize"];

interface Block {
   name: string;
   start: number;
   end: number;
}

const DECLARATION = /^(?:async )?(?:function|type|interface|const|let) (\w+)/;
const COMMENT_LINE = /^(?:\/\*\*| \*|\/\/)/;

/**
 * Finds the top-level declarations of the helpers, with the comment above and the blank line
 * below. A function or an interface ends at the next `}` in the first column, any other
 * declaration at the first line that ends with `;`.
 */
function findBlocks(lines: string[]): Block[] {
   const blocks: Block[] = [];
   for (let index = 0; index < lines.length; index++) {
      const name = DECLARATION.exec(lines[index])?.[1];
      if (name === undefined || !HELPERS.has(name)) {
         continue;
      }
      const closing = /^(?:async )?(?:function|interface) /.test(lines[index]) ? "}" : ";";
      let end = index;
      while (
         end < lines.length &&
         !(closing === "}" ? lines[end] === "}" : lines[end].endsWith(";"))
      ) {
         end++;
      }
      let start = index;
      while (start > 0 && COMMENT_LINE.test(lines[start - 1])) {
         start--;
      }
      blocks.push({ name, start, end: lines[end + 1] === "" ? end + 1 : end });
   }
   return blocks;
}

/** Whether the word is in the lines, outside of the block. */
function isReferenced(lines: string[], word: string, skip?: Block): boolean {
   const pattern = new RegExp(`\\b${word}\\b`);
   return lines.some((line, index) => {
      return !(skip && index >= skip.start && index <= skip.end) && pattern.test(line);
   });
}

/** Takes the unused names out of the `import { serialize as ipcSerialize, ... } from` line. */
function pruneSerializerImport(lines: string[]): string[] {
   const out = [...lines];
   for (let index = 0; index < out.length; index++) {
      if (
         !(
            /^import \{.*\} from /.test(out[index]) &&
            SERIALIZER_NAMES.some((n) => out[index].includes(n))
         )
      ) {
         continue;
      }
      const [, specifiers, from] = /^import \{(.*)\} from (.*)$/.exec(out[index]) as string[];
      const kept = specifiers
         .split(",")
         .map((part) => part.trim())
         .filter((part) => {
            const local = part.split(" as ").pop() as string;
            return (
               !SERIALIZER_NAMES.includes(local) || isReferenced(out.toSpliced(index, 1), local)
            );
         });
      out[index] = kept.length > 0 ? `import { ${kept.join(", ")} } from ${from}` : "";
   }
   return out.filter((line, index) => line !== "" || lines[index] === "");
}

/**
 * Removes the declarations of the shared helpers that nothing in the file uses. A helper which
 * only another unused helper uses goes too, so the result is the same whichever of the two comes
 * first. The text outside the helpers is returned as it was.
 */
export function pruneUnusedHelpers(text: string): string {
   let lines = text.split("\n");
   for (;;) {
      const unused = findBlocks(lines).find((block) => !isReferenced(lines, block.name, block));
      if (!unused) {
         break;
      }
      lines = [...lines.slice(0, unused.start), ...lines.slice(unused.end + 1)];
   }
   return pruneSerializerImport(lines).join("\n");
}
