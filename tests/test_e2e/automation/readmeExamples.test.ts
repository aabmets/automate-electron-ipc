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
import path from "node:path";
import {
   countExampleTags,
   extractReadmeExamples,
   type ReadmeExample,
} from "@testutils/e2e/readme-examples.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

const readme = await fsp.readFile(path.resolve(import.meta.dirname, "../../../README.md"), "utf8");

/**
 * Generates the bindings of the example's project and type-checks it: the schema files together
 * with the generated files, and then the other `.ts` files of the example, which import the
 * generated files. Throws an error that names the example when it does not generate or type-check.
 */
async function checkExample(example: ReadmeExample): Promise<void> {
   const files = Object.fromEntries(example.files.map(({ file, contents }) => [file, contents]));
   const fail = (reason: string) => {
      throw new Error(`README example '${example.name}': ${reason}`);
   };
   const project = await fixtures
      .run("readme-project", { files })
      .catch((error: Error) => fail(`it does not generate: ${error.message}`));
   const diagnostics = await project.typecheck();
   if (diagnostics !== "") {
      fail(`the schema and the generated files do not type-check:\n${diagnostics}`);
   }
   const userFiles = example.files
      .map(({ file }) => file)
      .filter((file) => file.endsWith(".ts") && !file.startsWith(`${project.ipcDataDir}/schema`));
   // The code of a service worker is a file in a `sw` directory. It is checked with the typings of
   // the worker, since they declare the same global `ipc` as the typings of the page do.
   const isWorkerFile = (file: string) => /(^|\/)sw\//.test(file);
   // The typings declare the global `ipc` that the code of a renderer or a worker uses. The checks
   // share the tsconfig of the project, so they run one after the other.
   const checkCode = async (codeFiles: string[], typings: string) => {
      if (codeFiles.length === 0) {
         return;
      }
      const userDiagnostics = await project.typecheckFiles([
         ...codeFiles,
         `${project.ipcDataDir}/${typings}`,
      ]);
      if (userDiagnostics !== "") {
         fail(`its code does not type-check:\n${userDiagnostics}`);
      }
   };
   await checkCode(
      userFiles.filter((file) => !isWorkerFile(file)),
      "window.d.ts",
   );
   await checkCode(userFiles.filter(isWorkerFile), "service-worker.d.ts");
}

const schema = (body: string) =>
   `import { defineChannels, send } from "automate-electron-ipc";\nexport default defineChannels({ ${body} });\n`;

describe("README example extraction", () => {
   const tag = (name: string, file: string, code: string) =>
      `<!-- readme-example: ${name} ${file} -->\n\`\`\`ts\n${code}\n\`\`\`\n`;

   it("groups the blocks of one name into the files of one project, in order", () => {
      const markdown = [
         tag("one", "src/autoipc/schema.ts", "const a = 1;"),
         "Text between.\n",
         tag("two", "src/autoipc/schema.ts", "const b = 2;"),
         tag("one", "src/main.ts", "const c = 3;"),
      ].join("\n");

      expect(extractReadmeExamples(markdown)).toEqual([
         {
            name: "one",
            files: [
               { file: "src/autoipc/schema.ts", contents: "const a = 1;\n" },
               { file: "src/main.ts", contents: "const c = 3;\n" },
            ],
         },
         { name: "two", files: [{ file: "src/autoipc/schema.ts", contents: "const b = 2;\n" }] },
      ]);
   });

   it("ignores a block without a tag directly above it", () => {
      const markdown = `\`\`\`ts\nconst a = 1;\n\`\`\`\n\n${tag("one", "a.ts", "x")}\ntext\n\`\`\`ts\ny\n\`\`\`\n`;

      expect(extractReadmeExamples(markdown).map((example) => example.name)).toEqual(["one"]);
   });

   it("refuses two blocks that give the same file of one example", () => {
      const markdown = tag("one", "a.ts", "x") + tag("one", "a.ts", "y");

      expect(() => extractReadmeExamples(markdown)).toThrow("gives the file 'a.ts' twice");
   });

   it("counts a tag whose block is not a ts block, so the README test can see it", () => {
      const markdown = "<!-- readme-example: one a.ts -->\n```bash\nls\n```\n";

      expect(countExampleTags(markdown)).toBe(1);
      expect(extractReadmeExamples(markdown)).toEqual([]);
   });
});

describe("README example check", () => {
   it("passes an example that generates and type-checks", async () => {
      const files = [
         {
            file: "src/autoipc/schema.ts",
            contents: schema("hello: send<(name: string) => void>()"),
         },
         {
            file: "src/main/index.ts",
            contents:
               'import { ipc } from "../autoipc/main";\nipc.hello.on((_event, name) => name.length);\n',
         },
         { file: "src/renderer/app.ts", contents: 'ipc.hello.send("Anonymous");\n' },
      ];

      await expect(checkExample({ name: "fine", files })).resolves.toBeUndefined();
   }, 60_000);

   it("fails with the name of an example whose schema does not generate", async () => {
      const files = [
         {
            file: "src/autoipc/schema.ts",
            contents: schema("hello: send<() => void>({ nope: 1 })"),
         },
      ];

      await expect(checkExample({ name: "broken-schema", files })).rejects.toThrow(
         "README example 'broken-schema': it does not generate",
      );
   }, 60_000);

   it("fails with the name of an example whose code does not type-check", async () => {
      const files = [
         {
            file: "src/autoipc/schema.ts",
            contents: schema("hello: send<(name: string) => void>()"),
         },
         { file: "src/renderer/app.ts", contents: "ipc.hello.send(1);\n" },
      ];

      await expect(checkExample({ name: "wrong-call", files })).rejects.toThrow(
         /README example 'wrong-call': its code does not type-check:[\s\S]*src\/renderer\/app\.ts/,
      );
   }, 60_000);
});

describe("README examples", () => {
   // Only `ts` and `json` blocks are tagged. The `electron.vite.config.ts` of the electron-vite
   // walk-through is shown without a tag: type-checking it would need the `electron-vite` package.
   const examples = extractReadmeExamples(readme);

   it("tags the examples of Getting Started and the Simple Example", () => {
      const names = examples.map((example) => example.name);

      expect(names).toEqual(expect.arrayContaining(["getting-started", "simple-example"]));
   });

   it("matches every tag with a ts block, so that no example is left unchecked", () => {
      const blocks = examples.reduce((sum, example) => sum + example.files.length, 0);

      expect(blocks).toBe(countExampleTags(readme));
   });

   it.each(examples.map((example) => [example.name, example] as const))(
      "generates and type-checks %s",
      async (_name, example) => {
         await checkExample(example);
      },
      120_000,
   );
});
