/**
 * Library for automating the generation of IPC components for Electron apps.
 *
 * Channels are declared in an exported channel map in the schema file:
 *
 * @example
 * import { defineChannels, invoke, send, emit, ask, stream, port, mainPort } from "automate-electron-ipc";
 * // Channels to a utility process: callUtility, notifyUtility, callMain, notifyMain, and
 * // invokeUtility and streamUtility, which a page uses directly.
 * // Channels to a service worker: invokeFromWorker, sendFromWorker, askWorker and emitToWorker.
 *
 * export default defineChannels({
 *    getUser: invoke<(id: number) => Promise<User>>(),
 *    echoUserName: send<(userName: string) => void>(),
 *    progress: emit<(n: number) => void>({ trigger: "focus" }),
 *    hasUnsavedChanges: ask<() => boolean>(),
 *    exportRows: stream<(table: string) => AsyncIterable<Row>>(),
 *    chat: port<(msg: string) => void>(),
 *    logTail: mainPort<(line: string) => void>(),
 * });
 */

export * from "./channel-base.js";
export * from "./config-renderer.js";
export * from "./config-utility.js";
export * from "./config-worker.js";
export * from "./verbs-renderer.js";
export * from "./verbs-utility.js";
export * from "./verbs-worker.js";
