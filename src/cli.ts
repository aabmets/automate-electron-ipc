#!/usr/bin/env node

import fs from "node:fs";
import { program } from "commander";
import { ipcAutomation } from "./automation.js";
import utils from "./utils.js";

program
   .name("ipcgen")
   .description("CLI tool for generating IPC components for Electron apps.")
   .version(
      (() => {
         const filePath = utils.searchUpwards("package.json");
         return JSON.parse(fs.readFileSync(filePath).toString()).version;
      })(),
      "-v, --version",
   )
   .action(ipcAutomation);

program.parse();
