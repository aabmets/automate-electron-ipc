#!/usr/bin/env node

import fs from "node:fs";
import type * as t from "@types";
import { program } from "commander";
import { ipcAutomation } from "./automation.js";
import { findStaleOutputs } from "./check.js";
import cfg from "./config.js";
import logger from "./logger.js";
import utils from "./utils.js";

/** Reports whether the generated files are up to date, and fails the process when they are not. */
async function runCheck(options: t.RunOptions): Promise<void> {
   const stale = await findStaleOutputs(options);
   const config = await cfg.getResolvedConfig(options);
   if (stale === null) {
      logger.nonExistentSchemaPath(config.ipcSchema.path);
   } else {
      logger.staleFiles(stale, config.projectRoot);
   }
   if (stale === null || stale.length > 0) {
      process.exitCode = 1;
   }
}

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
   .option("--check", "exit with 1 if the generated files are out of date, and write nothing")
   .action(async (options: { cwd?: string; config?: string; check?: boolean }) => {
      try {
         const runOptions = { cwd: options.cwd, configFile: options.config };
         await (options.check ? runCheck(runOptions) : ipcAutomation(runOptions));
      } catch (error) {
         logger.fatalError(error);
         process.exitCode = 1;
      }
   });

await program.parseAsync();
