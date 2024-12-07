#!/usr/bin/env node

import fs from "node:fs";
import { program } from "commander";
import { ipcAutomation } from "./index.js";
import utils from "./utils.js";

program
   .name("ipcgen")
   .description(
      "CLI tool for regenerating IPC bindings for Electron projects,\n" +
         "provided by the 'vite-plugin-automate-electron-ipc' library.",
   )
   .version(
      (() => {
         const filePath = utils.searchUpwards("package.json");
         return JSON.parse(fs.readFileSync(filePath).toString()).version;
      })(),
      "-v, --version",
   )
   .action(async () => await ipcAutomation().buildStart());

program.parse();
