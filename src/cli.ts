#!/usr/bin/env node

import fs from "node:fs";
import type * as t from "@types";
import { Option, program } from "commander";
import { ipcAutomation } from "./automation.js";
import { findStaleOutputs } from "./check.js";
import { type CliFlags, flagsToRunOptions } from "./cli-options.js";
import cfg from "./config.js";
import logger from "./logger.js";
import utils from "./utils.js";
import { watchSchema } from "./watch.js";

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
   .option(
      "--out-main <file>",
      "path of the generated main bindings, relative to the working directory",
   )
   .option(
      "--out-preload <file>",
      "path of the generated preload script, relative to the working directory",
   )
   .option(
      "--out-types <file>",
      "path of the generated renderer typings (.d.ts), relative to the working directory",
   )
   .option("--check", "exit with 1 if the generated files are out of date, and write nothing")
   .addOption(
      new Option(
         "--watch",
         "generate once, then again whenever the schema or the config changes",
      ).conflicts("check"),
   )
   .action(async (flags: CliFlags) => {
      try {
         const runOptions = flagsToRunOptions(flags);
         if (flags.watch) {
            const stop = watchSchema(runOptions);
            for (const signal of ["SIGINT", "SIGTERM"] as const) {
               process.once(signal, () => {
                  stop();
                  process.exit(0);
               });
            }
            return;
         }
         await (flags.check ? runCheck(runOptions) : ipcAutomation(runOptions));
      } catch (error) {
         logger.fatalError(error);
         process.exitCode = 1;
      }
   });

await program.parseAsync();
