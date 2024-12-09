#!/usr/bin/env node

import fs from "node:fs";
import { program } from "commander";
import { ipcAutomation } from "./automation.js";
import utils from "./utils.js";

program
   .name("ipcgen")
   .description(
      "CLI tool for regenerating IPC bindings for Electron projects,\n" +
         "provided by the 'automate-electron-ipc' library.",
   )
   .version(
      (() => {
         const filePath = utils.searchUpwards("package.json");
         return JSON.parse(fs.readFileSync(filePath).toString()).version;
      })(),
      "-v, --version",
   )
   .action(async () => await ipcAutomation());

program.parse();
