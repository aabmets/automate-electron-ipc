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

import fs from "node:fs";
import { promote, releaseNotes, versionHeadings } from "./changelog.js";

const USAGE =
   "Usage: changelog-release <check|promote|verify|notes> (NEW_VERSION in the environment)";
const FILE = "CHANGELOG.md";

function main(command: string | undefined, raw: string | undefined): void {
   const version = raw?.trim().replace(/^v/, "");
   if (!version) {
      throw new Error("NEW_VERSION is not set");
   }
   const changelog = fs.readFileSync(FILE, "utf8");
   const today = new Date().toISOString().slice(0, 10);
   switch (command) {
      case "check":
         // A dry run of the promotion: notes present, version unused, footer links in place.
         promote(changelog, version, today);
         break;
      case "promote":
         fs.writeFileSync(FILE, promote(changelog, version, today));
         break;
      case "verify": {
         const first = versionHeadings(changelog)[0];
         if (first !== version) {
            throw new Error(`${FILE} first version heading is ${first}, expected ${version}`);
         }
         break;
      }
      case "notes": {
         const notes = releaseNotes(changelog, version);
         if (notes === undefined) {
            throw new Error(`${FILE} has no notes for ${version}`);
         }
         process.stdout.write(`${notes}\n`);
         break;
      }
      default:
         throw new Error(USAGE);
   }
}

try {
   main(process.argv[2], process.env.NEW_VERSION);
} catch (error) {
   console.error(`::error::${(error as Error).message}`);
   process.exit(1);
}
