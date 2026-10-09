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

import { array, number, object, optional, refine, string } from "superstruct";
import { BROWSER_WINDOW_EVENTS } from "./browser-window-events.js";

export const TriggerStruct = refine(string(), "event", (value) => {
   if (BROWSER_WINDOW_EVENTS.includes(value)) {
      return true;
   }
   return (
      `'${value}' is not a BrowserWindow event. ` +
      `Use one of: ${BROWSER_WINDOW_EVENTS.join(", ")}`
   );
});

/**
 * `scheme://host[:port]` in lower case, as Chromium serializes the origin of a frame. The
 * port is matched loosely, so that a malformed one gets its own message.
 */
const ORIGIN_PATTERN =
   /^([a-z][a-z0-9+.-]*:)\/\/(\[[0-9a-f:.]+\]|[a-z0-9._~%-]*)(?::([a-z0-9]*))?$/;

/** The ports that Chromium leaves out of the origin of a URL, by scheme. */
const DEFAULT_PORTS: Record<string, string> = {
   "http:": "80",
   "https:": "443",
   "ws:": "80",
   "wss:": "443",
   "ftp:": "21",
};

/** A port is a number from 0 to 65535 in decimal digits. */
function isPortNumber(port: string): boolean {
   return /^\d{1,5}$/.test(port) && Number(port) <= 65535;
}

export const AllowedOriginsStruct = refine(array(string()), "origins", (values) => {
   if (values.length === 0) {
      return "allowedOrigins must list at least one origin, since an empty list allows no caller";
   }
   for (const value of values) {
      const match = ORIGIN_PATTERN.exec(value);
      if (match === null) {
         return (
            `'${value}' is not an origin. Write the scheme, the host and an optional port, ` +
            "in lower case and without a path, wildcard or credentials, " +
            "such as 'app://.' or 'http://localhost:5173'"
         );
      }
      const [, scheme, host, port] = match as unknown as [string, string, string, string?];
      if (port === undefined) {
         continue;
      }
      if (!isPortNumber(port)) {
         return (
            `'${value}' has the port '${port}', which is not a number from 0 to 65535. ` +
            "Write the port in digits, such as 'http://localhost:5173'"
         );
      }
      if (Number(DEFAULT_PORTS[scheme]) === Number(port)) {
         return (
            `'${value}' has the default port of its scheme, which no origin has, so it never ` +
            `matches a caller. Write '${scheme}//${host}'`
         );
      }
   }
   return true;
});

/** The names of scopes are part of file names, so they are lower case words joined by dashes. */
const SCOPE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_SCOPE_NAME_LENGTH = 32;
/** The name of the scope of the channels that have no `scopes`, which is the name of no scope. */
const RESERVED_SCOPE_NAME = "default";

export const ScopesStruct = refine(array(string()), "scopes", (values) => {
   if (values.length === 0) {
      return "scopes must list at least one scope, since an empty list puts the channel in no window";
   }
   const seen = new Set<string>();
   for (const value of values) {
      if (value === RESERVED_SCOPE_NAME) {
         return `'${RESERVED_SCOPE_NAME}' is the scope of the channels without scopes. Choose another name`;
      } else if (value.length > MAX_SCOPE_NAME_LENGTH || !SCOPE_NAME_PATTERN.test(value)) {
         return (
            `'${value}' is not a scope name. Use lower case letters and digits, joined by dashes ` +
            `and starting with a letter, up to ${MAX_SCOPE_NAME_LENGTH} characters, such as 'settings' or 'plugin-host'`
         );
      } else if (seen.has(value)) {
         return `scope '${value}' is listed twice`;
      }
      seen.add(value);
   }
   return true;
});

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;

export const ValidatorRefStruct = object({
   name: refine(string(), "identifier", (value) =>
      IDENTIFIER_NAME.test(value) ? true : `'${value}' is not an identifier`,
   ),
   exported: refine(string(), "identifier", (value) =>
      IDENTIFIER_NAME.test(value) ? true : `'${value}' is not an exported name`,
   ),
   fromPath: refine(string(), "module", (value) =>
      value.length > 0 ? true : "the module specifier of the validator is empty",
   ),
});

/** A reference in a signature that the writers may rewrite: a type name, or an import type path. */
export const TypeRefStruct = object({
   name: string(),
   start: number(),
   end: number(),
   importPath: optional(string()),
});
