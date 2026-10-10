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

const HEADING = /^## \[v?([^\]]+)\].*$/;
const FOOTER_LINE = /^\[[^\]]+\]:\s*\S+\s*$/;
const FOOTER_UNRELEASED = /^\[Unreleased\]:\s*(https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/\S+\s*$/;
const FOOTER_ANY = /^\[[^\]]+\]:\s*(https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\//;

interface Section {
   start: number;
   end: number;
}

function footerStart(lines: string[]): number {
   let i = lines.length;
   while (i > 0 && (lines[i - 1].trim() === "" || FOOTER_LINE.test(lines[i - 1]))) {
      i--;
   }
   const first = lines.findIndex((line, idx) => idx >= i && FOOTER_LINE.test(line));
   return first === -1 ? lines.length : first;
}

function findSection(lines: string[], name: string): Section | undefined {
   const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === name);
   if (start === -1) {
      return undefined;
   }
   const next = lines.findIndex((line, i) => i > start && HEADING.test(line));
   return { start, end: next === -1 ? footerStart(lines) : next };
}

function body(lines: string[], section: Section): string {
   return lines
      .slice(section.start + 1, section.end)
      .join("\n")
      .trim();
}

/** True when the section holds at least one bullet, not just empty `### Added` style headings. */
function hasNotes(text: string): boolean {
   return /^\s*[-*] \S/m.test(text);
}

/** Version headings (`## [x.y.z] - date`), newest first. Unreleased is not one. */
export function versionHeadings(changelog: string): string[] {
   return changelog
      .split(/\r?\n/)
      .map((line) => HEADING.exec(line)?.[1])
      .filter((name): name is string => name !== undefined && name !== "Unreleased");
}

export function hasUnreleasedNotes(changelog: string): boolean {
   const lines = changelog.split(/\r?\n/);
   const section = findSection(lines, "Unreleased");
   return section !== undefined && hasNotes(body(lines, section));
}

export function releaseNotes(changelog: string, version: string): string | undefined {
   const lines = changelog.split(/\r?\n/);
   const section = findSection(lines, version);
   if (section === undefined) {
      return undefined;
   }
   const notes = body(lines, section);
   return hasNotes(notes) ? notes : undefined;
}

function repoBase(lines: string[]): string {
   for (const re of [FOOTER_UNRELEASED, FOOTER_ANY]) {
      const base = lines.map((line) => re.exec(line)?.[1]).find(Boolean);
      if (base) {
         return base;
      }
   }
   throw new Error("The changelog footer has no GitHub links");
}

/** Points `[Unreleased]` at the new version and adds the compare (or first tag) link of it. */
function rewriteFooter(lines: string[], version: string, previous: string | undefined): string[] {
   const base = repoBase(lines);
   const unreleased = `[Unreleased]: ${base}/compare/${version}...HEAD`;
   const link = previous
      ? `[${version}]: ${base}/compare/${previous}...${version}`
      : `[${version}]: ${base}/releases/tag/${version}`;
   const at = lines.findIndex((line) => line.startsWith("[Unreleased]:"));
   if (at === -1) {
      return [...lines.slice(0, footerStart(lines)), unreleased, link, ""];
   }
   const out = [...lines];
   out.splice(at, 1, unreleased, link);
   return out;
}

/**
 * Moves the Unreleased notes under a new dated version heading, and fixes the footer links.
 * Returns the changelog unchanged when the newest version heading is the version already.
 */
export function promote(changelog: string, version: string, date: string): string {
   // A rerun of a release whose bump commit is already on the branch: nothing left to promote.
   const done = versionHeadings(changelog)[0] === version && !hasUnreleasedNotes(changelog);
   if (done && releaseNotes(changelog, version) !== undefined) {
      return changelog;
   }
   if (!hasUnreleasedNotes(changelog)) {
      throw new Error("The Unreleased section of the changelog has no notes");
   }
   const lines = changelog.split(/\r?\n/);
   const previous = versionHeadings(changelog)[0];
   const linked = lines.some((line) => line.startsWith(`[${version}]:`));
   if (findSection(lines, version) !== undefined || linked) {
      throw new Error(`The changelog already has a section or link for ${version}`);
   }
   const { start } = findSection(lines, "Unreleased") as Section;
   lines.splice(start + 1, 0, "", `## [${version}] - ${date}`);
   return rewriteFooter(lines, version, previous).join("\n");
}
