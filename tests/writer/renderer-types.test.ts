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
import utils from "@src/utils.js";
import { describe, expect, it } from "vitest";
import mocks from "../mocks.js";
import shared from "./shared.js";

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   it("should write empty Window declaration when pfsArray is empty", async () => {
      const obj = new shared.VitestRendererTypesWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = "\ndeclare global {\n   interface Window {}\n}";
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Unicast RendererToMain callables into Window declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  sendVitestChannel: (arg1: CustomType, arg2?: CustomType) => Promise<string>;
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Broadcast RendererToMain callables into Window declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  sendVitestChannel: (arg1: string, arg2: string) => void;
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Broadcast MainToRenderer callables into Window declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  onVitestChannel: (callback: (arg1: number, ...arg2: number) => Promise<CustomType>) => void;
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });
});
