#!/usr/bin/env node

import fs from "node:fs";
import { program } from "commander";
import { ipcAutomation } from "./automation.js";
import logger from "./logger.js";
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
   .option(
      "--cwd <dir>",
      "directory to find the project root from (default: the working directory)",
   )
   .option("--config <file>", "config file to read, relative to the working directory")
   .action(async (options: { cwd?: string; config?: string }) => {
      try {
         await ipcAutomation({ cwd: options.cwd, configFile: options.config });
      } catch (error) {
         logger.fatalError(error);
         process.exitCode = 1;
      }
   });

await program.parseAsync();
