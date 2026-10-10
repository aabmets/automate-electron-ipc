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

import { describe, expect, it } from "vitest";
import {
   hasUnreleasedNotes,
   promote,
   releaseNotes,
   versionHeadings,
} from "../scripts/changelog.js";

const BASE = "https://github.com/aabmets/automate-electron-ipc";

const FIRST = `# Changelog

## [Unreleased]

### Added

- A new thing

[Unreleased]: ${BASE}/commits/main
`;

const WITH_NOTES = `# Changelog

## [Unreleased]

### Added

- A new thing

## [1.0.0] - 2026-01-01

### Added

- First release

[Unreleased]: ${BASE}/compare/1.0.0...HEAD
[1.0.0]: ${BASE}/releases/tag/1.0.0
`;

const EMPTY = `# Changelog

## [Unreleased]

### Added

## [1.0.0] - 2026-01-01

- First release

[Unreleased]: ${BASE}/compare/1.0.0...HEAD
`;

describe("hasUnreleasedNotes", () => {
   it("is true when Unreleased has a bullet", () => {
      expect(hasUnreleasedNotes(WITH_NOTES)).toBe(true);
   });

   it("is false for headings without bullets, even if an older section has bullets", () => {
      expect(hasUnreleasedNotes(EMPTY)).toBe(false);
   });

   it("is false without an Unreleased section", () => {
      expect(hasUnreleasedNotes(`# Changelog\n\n## [1.0.0]\n\n- x\n\n[1.0.0]: ${BASE}/x\n`)).toBe(
         false,
      );
   });

   it("handles CRLF line endings", () => {
      expect(hasUnreleasedNotes(WITH_NOTES.replaceAll("\n", "\r\n"))).toBe(true);
   });
});

describe("versionHeadings", () => {
   it("lists versions newest first, tolerating a v prefix, and skips Unreleased", () => {
      const text = "## [Unreleased]\n\n## [v1.2.0] - x\n\n## [1.1.0] - y\n";
      expect(versionHeadings(text)).toEqual(["1.2.0", "1.1.0"]);
   });
});

describe("promote", () => {
   it("moves the notes under a dated version and leaves an empty Unreleased", () => {
      const out = promote(WITH_NOTES, "1.1.0", "2026-02-02");
      expect(out).toContain(
         "## [Unreleased]\n\n## [1.1.0] - 2026-02-02\n\n### Added\n\n- A new thing",
      );
      expect(hasUnreleasedNotes(out)).toBe(false);
      expect(releaseNotes(out, "1.1.0")).toBe("### Added\n\n- A new thing");
      expect(releaseNotes(out, "1.0.0")).toBe("### Added\n\n- First release");
   });

   it("points Unreleased at the new version and links it to the previous one", () => {
      const out = promote(WITH_NOTES, "1.1.0", "2026-02-02");
      expect(out).toContain(
         `[Unreleased]: ${BASE}/compare/1.1.0...HEAD\n[1.1.0]: ${BASE}/compare/1.0.0...1.1.0\n[1.0.0]:`,
      );
   });

   it("links the first release to its tag, and keeps the footer out of its notes", () => {
      const out = promote(FIRST, "1.0.0", "2026-02-02");
      expect(out).toContain(
         `[Unreleased]: ${BASE}/compare/1.0.0...HEAD\n[1.0.0]: ${BASE}/releases/tag/1.0.0`,
      );
      expect(releaseNotes(out, "1.0.0")).toBe("### Added\n\n- A new thing");
   });

   it("adds the Unreleased link when the footer lacks it", () => {
      const text = FIRST.replace(/^\[Unreleased\]:.*\n/m, `[0.1.0]: ${BASE}/releases/tag/0.1.0\n`);
      expect(promote(text, "1.0.0", "d")).toContain(`[Unreleased]: ${BASE}/compare/1.0.0...HEAD`);
   });

   it("throws without GitHub links in the footer", () => {
      expect(() => promote("## [Unreleased]\n\n- x\n", "1.0.0", "d")).toThrow(/no GitHub links/);
   });

   it("throws when Unreleased has no notes", () => {
      expect(() => promote(EMPTY, "1.1.0", "2026-02-02")).toThrow(/no notes/);
   });

   it("throws when the version already has a section or a link", () => {
      expect(() => promote(WITH_NOTES, "1.0.0", "2026-02-02")).toThrow(/already has/);
      const linked = FIRST.replace("[Unreleased]:", "[1.2.0]: x\n[Unreleased]:");
      expect(() => promote(linked, "1.2.0", "d")).toThrow(/already has/);
   });
});

describe("releaseNotes", () => {
   it("returns the body of the version section only", () => {
      expect(releaseNotes(WITH_NOTES, "1.0.0")).toBe("### Added\n\n- First release");
   });

   it("is undefined for a missing version or a section without bullets", () => {
      expect(releaseNotes(WITH_NOTES, "2.0.0")).toBeUndefined();
      expect(releaseNotes(EMPTY, "Unreleased")).toBeUndefined();
   });
});
