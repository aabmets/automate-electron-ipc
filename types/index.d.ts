/**
 * Library for automating the generation of IPC components for Electron apps.
 *
 * Channels are declared in an exported channel map in the schema file:
 *
 * @example
 * import { defineChannels, invoke, send, emit, port } from "automate-electron-ipc";
 *
 * export default defineChannels({
 *    getUser: invoke<(id: number) => Promise<User>>(),
 *    echoUserName: send<(userName: string) => void>(),
 *    progress: emit<(n: number) => void>({ trigger: "focus" }),
 *    chat: port<(msg: string) => void>(),
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
 * The Standard Schema interface (https://standardschema.dev), which zod, valibot, arktype and
 * other libraries implement. It is copied here so that this package needs no dependency.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
   readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
   readonly version: 1;
   readonly vendor: string;
   readonly validate: (
      value: unknown,
   ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
   readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

export type StandardSchemaV1Result<Output> =
   | { readonly value: Output; readonly issues?: undefined }
   | { readonly issues: readonly StandardSchemaV1Issue[] };

export interface StandardSchemaV1Issue {
   readonly message: string;
   readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

/**
 * The schema of the arguments of a channel, as a Standard Schema of the tuple `Parameters<S>`.
 * Input is not constrained, since the arguments come from an untrusted renderer. In the
 * `verb(config) as Signature` form, which does not check the config against the signature,
 * any Standard Schema is accepted.
 */
export type ArgumentsSchema<S extends ChannelSignature> = [S] extends [never]
   ? StandardSchemaV1
   : StandardSchemaV1<unknown, Parameters<S>>;

/**
 * Options of `invoke` channels.
 *
 * @property allowedOrigins - The origins which may call the channel, such as
 *    `["app://.", "http://localhost:5173"]`. The generated main bindings compare each one for
 *    equality with `event.senderFrame.origin`, and reject calls from any other origin. An origin
 *    is a scheme, a host and an optional port, in lower case, without a path or a wildcard.
 * @property validate - A Standard Schema (zod, valibot, arktype, ...) of the argument tuple of
 *    the signature. It must be an identifier which the schema file imports as a value, such as
 *    `import { getUserArgs } from "./validators"`. The generated main bindings validate the
 *    arguments that the renderer sent before they call the handler, and reject the call with an
 *    `IpcValidationError` when they are invalid. The handler receives the validated output.
 */
export interface InvokeConfig<S extends ChannelSignature = ChannelSignature> {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
}

/**
 * Options of `send` channels.
 *
 * @property allowedOrigins - The origins which may send to the channel. See `InvokeConfig`.
 * @property validate - A Standard Schema of the arguments. See `InvokeConfig`. A message with
 *    invalid arguments is dropped, and reported to the `onRejected` hook.
 */
export interface SendConfig<S extends ChannelSignature = ChannelSignature> {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
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
 * @property trigger - Name of a BrowserWindow event. For a channel with a trigger, the main
 *    bindings also contain a `bind<Name>(browserWindow, provider)` callable. It registers one
 *    listener for the event, calls the provider each time the event fires and sends the
 *    arguments that the provider returns. It returns a function which removes the listener.
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
      | "persisted-state-restored"
      | "query-session-end"
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
 *    getUser: invoke<(id: number) => Promise<User>>(),
 * });
 */
export function defineChannels<T extends Record<string, unknown>>(channels: T): T;

/**
 * Request and response from a renderer process to the main process.
 * The main process handles the call and its result is returned to the invoker.
 * The signature may return any value, or a promise of it.
 *
 * @example
 * getUser: invoke<(id: number) => Promise<User>>()
 * // Alternative form, which does not check the config against the signature:
 * getUser: invoke() as (id: number) => Promise<User>
 */
export function invoke<S extends ChannelSignature = never>(
   config?: InvokeConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from a renderer process to the main process.
 * No response is returned. The signature must return `void` or `Promise<void>`.
 *
 * @example
 * echoUserName: send<(userName: string) => void>()
 */
export function send<S extends ChannelSignature = never>(
   config?: SendConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a renderer process.
 * The signature must return `void` or `Promise<void>`.
 * If a trigger is given, then a `bind<Name>` callable is generated in addition to the sender,
 * which sends automatically when that BrowserWindow event fires.
 *
 * @example
 * progress: emit<(n: number) => void>({ trigger: "focus" })
 */
export function emit<S extends ChannelSignature = never>(
   config?: EmitConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Two-way channel between two renderer processes over a single message port.
 * The signature must return `void` or `Promise<void>`.
 *
 * @example
 * chat: port<(msg: string) => void>()
 */
export function port<S extends ChannelSignature = never>(
   config?: PortConfig<NoInfer<S>>,
): ChannelResult<S>;
