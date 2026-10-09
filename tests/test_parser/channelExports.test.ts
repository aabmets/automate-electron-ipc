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

import { parseModule } from "@src/ast.js";
import { parseChannelMapModule } from "@src/channel-map.js";
import { describe, expect, it } from "vitest";

const IMPORT = 'import { defineChannels, send } from "automate-electron-ipc";';
const MAP = "defineChannels({ ping: send<() => void>() })";

function exportOf(code: string) {
   const { module, src } = parseModule(`${IMPORT}\n${code}`);
   return parseChannelMapModule(module, src, "schema.ts");
}

describe("channel map exports, the map is exported in the declaration", () => {
   it("skips a declarator without an initializer", () => {
      const { channelMapExport } = exportOf(`export let unset, channels = ${MAP};`);
      expect(channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
   });
});

describe("channel map exports, the map is exported later", () => {
   it("skips declarators which are not the map", () => {
      const { channelMapExport } = exportOf(`
         let unset, count = 1;
         const channels = ${MAP};
         export { channels };
      `);
      expect(channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
   });

   it("passes by the default export of another identifier", () => {
      const { channelMapExport } = exportOf(`
         const other = 1;
         const channels = ${MAP};
         export default other;
         export { channels as api };
      `);
      expect(channelMapExport).toStrictEqual({ kind: "named", name: "api" });
   });

   it("passes by the named exports of other locals", () => {
      const { channelMapExport } = exportOf(`
         const other = 1;
         const channels = ${MAP};
         export { other };
         export { channels };
      `);
      expect(channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
   });

   it("exports the map as the default with `export { m as default }`", () => {
      const { channelMapExport } = exportOf(`
         const channels = ${MAP};
         export { channels as default };
      `);
      expect(channelMapExport).toStrictEqual({ kind: "default" });
   });

   it("exports the map as the default with `export default m`", () => {
      const { channelMapExport } = exportOf(`
         const channels = ${MAP};
         export default channels;
      `);
      expect(channelMapExport).toStrictEqual({ kind: "default" });
   });
});

describe("channel map exports, errors", () => {
   it("rejects a map that no export names", () => {
      expect(() => exportOf(`const other = 1;\nconst channels = ${MAP};`)).toThrow(
         "the defineChannels call must be exported",
      );
   });
});
