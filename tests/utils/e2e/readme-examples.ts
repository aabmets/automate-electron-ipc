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

/** One tagged code block of the README: a file of the fixture project that its name stands for. */
export interface ReadmeExampleFile {
   /** The path of the file inside the fixture project, such as `src/autoipc/schema.ts`. */
   file: string;
   contents: string;
}

/** The tagged blocks of the README that share a name: one fixture project. */
export interface ReadmeExample {
   name: string;
   files: ReadmeExampleFile[];
}

/**
 * A tagged block: the comment `<!-- readme-example: <name> <file> -->` on the line before a fenced
 * block of `ts` (or `typescript`, or `json` for a `package.json`). The comment is invisible in the
 * rendered README, so the tag does not change how it reads.
 */
const EXAMPLE_BLOCK =
   /<!-- readme-example: (\S+) (\S+) -->\r?\n```(?:ts|typescript|json)\r?\n([\s\S]*?)\r?\n```/g;

/**
 * Finds the tagged examples of the README. The blocks of one name are the files of one project, in
 * the order of the README. A file that two blocks of the same name give is an error, since the
 * second would silently replace the first.
 */
export function extractReadmeExamples(markdown: string): ReadmeExample[] {
   const examples = new Map<string, ReadmeExample>();
   for (const [, name, file, contents] of markdown.matchAll(EXAMPLE_BLOCK)) {
      const example = examples.get(name) ?? { name, files: [] };
      if (example.files.some((existing) => existing.file === file)) {
         throw new Error(`README example '${name}' gives the file '${file}' twice.`);
      }
      example.files.push({ file, contents: `${contents}\n` });
      examples.set(name, example);
   }
   return [...examples.values()];
}

/** The number of tags in the README, to catch a tag whose block the pattern does not match. */
export function countExampleTags(markdown: string): number {
   return markdown.match(/<!-- readme-example:/g)?.length ?? 0;
}
