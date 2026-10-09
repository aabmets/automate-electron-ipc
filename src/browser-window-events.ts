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

/**
 * The BrowserWindow events from the Electron docs which can be used as a `trigger`.
 * Keep in sync with `EmitConfig['trigger']` in `types/config-renderer.d.ts`.
 */
export const BROWSER_WINDOW_EVENTS: readonly string[] = [
   "show",
   "ready-to-show",
   "app-command",
   "blur",
   "close",
   "always-on-top-changed",
   "closed",
   "enter-full-screen",
   "enter-html-full-screen",
   "focus",
   "hide",
   "leave-full-screen",
   "leave-html-full-screen",
   "maximize",
   "minimize",
   "move",
   "moved",
   "new-window-for-tab",
   "page-title-updated",
   "persisted-state-restored",
   "query-session-end",
   "resize",
   "resized",
   "responsive",
   "restore",
   "rotate-gesture",
   "session-end",
   "sheet-begin",
   "sheet-end",
   "swipe",
   "system-context-menu",
   "unmaximize",
   "unresponsive",
   "will-move",
   "will-resize",
];
