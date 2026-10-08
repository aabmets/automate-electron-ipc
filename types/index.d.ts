/**
 * Library for automating the generation of IPC components for Electron apps.
 *
 * Channels are declared in an exported channel map in the schema file:
 *
 * @example
 * import { defineChannels, invoke, send, emit, port } from "automate-electron-ipc";
 *
 * export default defineChannels({
 *    GetUser: invoke<(id: number) => Promise<User>>(),
 *    EchoUserName: send<(userName: string) => void>(),
 *    Progress: emit<(n: number) => void>({ trigger: "focus" }),
 *    Chat: port<(msg: string) => void>(),
 * });
 */

declare const channelDef: unique symbol;

/**
 * Any function type. Signatures of channels must be function types.
 */
export type ChannelSignature = (...args: any[]) => any;

/**
 * Branded value returned by the verb helpers when a signature type argument is given.
 * It carries the signature at the type level only, nothing exists at runtime.
 */
export interface ChannelDef<S extends ChannelSignature = ChannelSignature> {
   readonly [channelDef]: S;
}

/**
 * The type returned by verb helpers: a `ChannelDef<S>` when the signature `S` is given
 * as a type argument, otherwise `unknown`, so that `verb(config) as Signature` type-checks.
 */
export type ChannelResult<S extends ChannelSignature> = [S] extends [never]
   ? unknown
   : ChannelDef<S>;

/**
 * Options of `invoke` channels. There are none yet.
 */
export interface InvokeConfig<_S extends ChannelSignature = ChannelSignature> {
   [option: string]: never;
}

/**
 * Options of `send` channels. There are none yet.
 */
export interface SendConfig<_S extends ChannelSignature = ChannelSignature> {
   [option: string]: never;
}

/**
 * Options of `port` channels. There are none yet.
 */
export interface PortConfig<_S extends ChannelSignature = ChannelSignature> {
   [option: string]: never;
}

/**
 * Options of `emit` channels.
 *
 * @property trigger - Name of a BrowserWindow event. When it fires in the main process,
 *    the sender callable is invoked automatically.
 */
export interface EmitConfig<_S extends ChannelSignature = ChannelSignature> {
   trigger?:
      | "show"
      | "ready-to-show"
      | "app-command"
      | "blur"
      | "close"
      | "always-on-top-changed"
      | "closed"
      | "enter-full-screen"
      | "enter-html-full-screen"
      | "focus"
      | "hide"
      | "leave-full-screen"
      | "leave-html-full-screen"
      | "maximize"
      | "minimize"
      | "move"
      | "moved"
      | "new-window-for-tab"
      | "page-title-updated"
      | "resize"
      | "resized"
      | "responsive"
      | "restore"
      | "rotate-gesture"
      | "session-end"
      | "sheet-begin"
      | "sheet-end"
      | "swipe"
      | "system-context-menu"
      | "unmaximize"
      | "unresponsive"
      | "will-move"
      | "will-resize";
}

/**
 * Declares the channels of the application. The key of each property is the channel name.
 * The map must be exported from the schema file, either as the default export
 * or as a named `const` export, and a file may contain only one `defineChannels` call.
 *
 * @example
 * export default defineChannels({
 *    GetUser: invoke<(id: number) => Promise<User>>(),
 * });
 */
export function defineChannels<T extends Record<string, unknown>>(channels: T): T;

/**
 * Request and response from a renderer process to the main process.
 * The main process handles the call and its result is returned to the invoker.
 * The signature may return any value, or a promise of it.
 *
 * @example
 * GetUser: invoke<(id: number) => Promise<User>>()
 * // Alternative form, which does not check the config against the signature:
 * GetUser: invoke() as (id: number) => Promise<User>
 */
export function invoke<S extends ChannelSignature = never>(
   config?: InvokeConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from a renderer process to the main process.
 * No response is returned. The signature must return `void` or `Promise<void>`.
 *
 * @example
 * EchoUserName: send<(userName: string) => void>()
 */
export function send<S extends ChannelSignature = never>(
   config?: SendConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a renderer process.
 * The signature must return `void` or `Promise<void>`.
 * If a trigger is given, then the sender callable is invoked automatically
 * when that BrowserWindow event fires.
 *
 * @example
 * Progress: emit<(n: number) => void>({ trigger: "focus" })
 */
export function emit<S extends ChannelSignature = never>(
   config?: EmitConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Two-way channel between two renderer processes over a single message port.
 * The signature must return `void` or `Promise<void>`.
 *
 * @example
 * Chat: port<(msg: string) => void>()
 */
export function port<S extends ChannelSignature = never>(
   config?: PortConfig<NoInfer<S>>,
): ChannelResult<S>;
