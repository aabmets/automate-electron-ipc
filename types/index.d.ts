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

declare const channelDef: unique symbol;
declare const channelErrors: unique symbol;

/**
 * Any function type. Signatures of channels must be function types.
 */
export type ChannelSignature = (...args: any[]) => any;

/**
 * Branded value returned by the verb helpers when a signature type argument is given.
 * It carries the signature, and the error types of an `invoke` channel, at the type level
 * only, nothing exists at runtime.
 */
export interface ChannelDef<S extends ChannelSignature = ChannelSignature, E = never> {
   readonly [channelDef]: S;
   readonly [channelErrors]?: E;
}

/**
 * The type returned by verb helpers: a `ChannelDef<S>` when the signature `S` is given
 * as a type argument, otherwise `unknown`, so that `verb(config) as Signature` type-checks.
 */
export type ChannelResult<S extends ChannelSignature, E = never> = [S] extends [never]
   ? unknown
   : ChannelDef<S, E>;

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
 * Options of the channels that a page takes part in.
 *
 * @property scopes - The scopes that the channel belongs to, such as `["settings", "editor"]`:
 *    lower case words, joined by dashes, up to 32 characters. Without `scopes` the channel is open
 *    to all windows. With them, only the windows of one of these scopes have it:
 *    - `ipcgen` generates a preload script and a `.d.ts` file for each scope, as
 *      `preload.<scope>.ts` and `window.<scope>.d.ts`, with the channels of the scope and the ones
 *      without `scopes`. The usual `preload.ts` and `window.d.ts` have only the channels without
 *      `scopes`, which is all of them in a schema that uses no scopes;
 *    - the generated `main.ts` exports `registerScope(window, scope)`, which puts the contents of
 *      a window, a view or contents into a scope. The main process rejects a call (`invoke`,
 *      `send` or `stream`) to a channel with `scopes` from contents that are not registered in one
 *      of them, with an `IpcForbiddenError`, and drops a `send` from them, like a sender that
 *      `allowedOrigins` does not allow. The `onRejected` hook of `configureIpc` hears of it.
 *      Contents that are in no scope can call the channels without `scopes` only.
 */
export interface ScopedConfig {
   scopes?: readonly string[];
}

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
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of `ipc.<name>.invoke` is rejected with an `IpcTimeoutError`, which is
 *    the plain object `{ name: "IpcTimeoutError", message, code: "IPC_TIMEOUT" }`. The handler is
 *    not stopped, and its late reply is dropped. `0` turns the timeout off for this channel,
 *    also when the `timeoutMs` of the `autoipc` config in `package.json` sets a default.
 */
export interface InvokeConfig<S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
   timeoutMs?: number;
}

/**
 * Options of `send` channels.
 *
 * @property allowedOrigins - The origins which may send to the channel. See `InvokeConfig`.
 * @property validate - A Standard Schema of the arguments. See `InvokeConfig`. A message with
 *    invalid arguments is dropped, and reported to the `onRejected` hook.
 */
export interface SendConfig<S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
}

/**
 * Options of `stream` channels.
 *
 * @property allowedOrigins - The origins which may start the stream. See `InvokeConfig`.
 * @property validate - A Standard Schema of the arguments. See `InvokeConfig`. A call with invalid
 *    arguments fails the stream with an `IpcValidationError`, before the handler runs.
 * @property highWaterMark - The most chunks that the generator may be ahead of the page: the main
 *    process sends this many chunks, and then stops pulling from the generator until the page has
 *    read some of them. A non-negative integer literal, or `Infinity` for no limit. The default is
 *    1024. The unit is the chunk, whatever its size, so lower it for large chunks. `0` makes the
 *    stream pull-based: the generator is asked for a chunk only while the page waits for one.
 */
export interface StreamConfig<S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
   highWaterMark?: number;
}

/**
 * Options of `port` channels.
 *
 * @property maxQueue - The most messages that `send` queues while there is no port to send to:
 *    before the page has loaded, after a port has closed, and, for the channel itself, while
 *    there is no connection yet. A non-negative integer literal, or `Infinity`. The default is
 *    1000. `0` queues nothing. A message that does not fit is handled by the overflow callback,
 *    which the page registers with `ipc.<name>.onOverflow`, and the oldest message is dropped by
 *    default. The first drop is logged with `console.warn`, and then every 100th.
 */
export interface PortConfig<_S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   maxQueue?: number;
}

/**
 * Options of `mainPort` channels.
 *
 * @property maxQueue - The most messages that a send queue holds while there is no port, in the
 *    preload script and in the main process. See `PortConfig`. The main process registers its
 *    overflow callback with `configurePorts` and `connection.onOverflow`.
 */
export interface MainPortConfig<_S extends ChannelSignature = ChannelSignature>
   extends ScopedConfig {
   maxQueue?: number;
}

/**
 * Options of `ask` channels. See `ScopedConfig` for `scopes`: a window of another scope has no
 * responder for the question, so it never answers the main process.
 */
export interface AskConfig<_S extends ChannelSignature = ChannelSignature> extends ScopedConfig {}

/**
 * Options of the channels between the main process and a utility process
 * (`callUtility`, `notifyUtility`, `callMain` and `notifyMain`). See `UtilityCallConfig` for the
 * options of the two that wait for an answer. `notifyUtility` and `notifyMain` have none.
 */
export interface UtilityConfig<_S extends ChannelSignature = ChannelSignature> {
   [option: string]: never;
}

/**
 * Options of `callUtility` and `callMain` channels.
 *
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of the call is rejected with an `IpcUtilityError` with the code
 *    `IPC_UTILITY_TIMEOUT`. The handler is not stopped, and its late reply is dropped. `0` turns the
 *    timeout off for this channel, also when the `timeoutMs` of the `autoipc` config in
 *    `package.json` sets a default.
 */
export interface UtilityCallConfig<_S extends ChannelSignature = ChannelSignature> {
   timeoutMs?: number;
}

/**
 * Options of the channels between a renderer and a utility process (`invokeUtility` and
 * `streamUtility`). See `ScopedConfig` for `scopes`, which decides which windows have the channel in
 * their API. The main process pairs a window with a child in `connect`, whatever the scope is.
 *
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of `ipc.<name>.invoke` is rejected with the plain object
 *    `{ name: "IpcUtilityError", message, code: "IPC_UTILITY_TIMEOUT" }`. The timer starts when the
 *    page makes the call, so it covers the wait for the connection too. The handler in the child
 *    is not stopped, and its late reply is dropped. `0` turns the timeout off for this channel, also
 *    when the `timeoutMs` of the `autoipc` config in `package.json` sets a default. On a
 *    `streamUtility` channel, see `UtilityStreamConfig`.
 */
export interface UtilityPortConfig<_S extends ChannelSignature = ChannelSignature>
   extends ScopedConfig {
   timeoutMs?: number;
}

/**
 * Options of `streamUtility` channels. See `UtilityPortConfig`.
 *
 * @property highWaterMark - The most chunks that the generator in the child may be ahead of the
 *    page. See `StreamConfig`. The window is per call, though all the streams of a channel share
 *    one port.
 * @property timeoutMs - A non-negative integer literal. A stream that has not sent its first
 *    chunk, its end or an error after this many milliseconds is cancelled in the child, and the
 *    read of the page is rejected with the plain object `{ name: "IpcUtilityError", message, code:
 *    "IPC_UTILITY_TIMEOUT" }`. A stream that has begun is not cut short, since a slow reader holds
 *    the generator back on purpose. Unlike for the calls, the `timeoutMs` of the config in
 *    `package.json` is not a default for it: `0`, the default, waits for ever.
 */
export interface UtilityStreamConfig<S extends ChannelSignature = ChannelSignature>
   extends UtilityPortConfig<S> {
   highWaterMark?: number;
}

/**
 * Options of the channels that a service worker calls in the main process (`invokeFromWorker` and
 * `sendFromWorker`).
 *
 * @property allowedOrigins - The origins which may use the channel, such as `["app://."]`. The
 *    generated main bindings compare each one for equality with the origin of the scope of the
 *    service worker, and reject calls from any other origin. An origin is a scheme, a host and an
 *    optional port, in lower case, without a path or a wildcard. The events of a service worker
 *    have no `senderFrame`, so this and the `validateSender` hook of `configureServiceWorkerIpc`,
 *    which sees `versionId` and `serviceWorker.scope`, are the sender checks.
 */
export interface WorkerCallConfig<_S extends ChannelSignature = ChannelSignature> {
   allowedOrigins?: readonly string[];
}

/**
 * Options of the channels from the main process to a service worker (`askWorker` and
 * `emitToWorker`). There are none yet.
 */
export interface WorkerNotifyConfig<_S extends ChannelSignature = ChannelSignature> {
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
export interface EmitConfig<_S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
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
 * An error that the handler throws reaches the renderer as a plain object
 * `{ name, message, code?, data? }`, which rejects the promise of `ipc.<name>.invoke`.
 * The optional second type argument lists the error types that the handler may throw. It
 * documents them in the generated `window.d.ts`. It needs the generic form of the signature.
 *
 * @example
 * getUser: invoke<(id: number) => Promise<User>, NotFoundError | AuthError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * getUser: invoke() as (id: number) => Promise<User>
 */
export function invoke<S extends ChannelSignature = never, E extends Error = never>(
   config?: InvokeConfig<NoInfer<S>>,
): ChannelResult<S, E>;

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
 * Request and response from the main process to a renderer process: the main process asks and
 * awaits the answer, such as "are there unsaved changes?" on `close`. Electron has no invoke
 * in this direction, so the generated code sends the request with a correlation ID and the
 * renderer answers on a reply channel.
 *
 * The main process calls `ipc.<name>.invoke(target, ...args)`, or
 * `ipc.<name>.invokeWith(target, { timeoutMs }, ...args)`, and gets a promise of the answer.
 * It rejects with an `IpcAskError` when the target is destroyed, when the timeout passes, when
 * the renderer has no handler, and when the handler throws. The renderer registers its single
 * responder with `ipc.<name>.handle(callback)`, which returns a function that removes it.
 * The signature may return any value, or a promise of it.
 *
 * @example
 * hasUnsavedChanges: ask<(documentId: number) => boolean>()
 */
export function ask<S extends ChannelSignature = never>(
   config?: AskConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Stream of results from the main process to a renderer process, with cancellation, for downloads,
 * exports, long jobs and token streams. The signature takes the arguments of the call and returns
 * an `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>`, and the
 * handler in the main process is an `async function*`. Each call gets a message channel of its own,
 * which carries the chunks in order, then the end or the error of the stream.
 *
 * The page calls `ipc.<name>.stream(...args)`, which returns an async iterator with `cancel()`:
 * `for await (const chunk of ipc.<name>.stream(...))` reads the chunks, and `break`, `return()`
 * and `cancel()` stop the stream and call `return()` on the generator in the main process. An
 * `AbortSignal` cannot cross `contextBridge`, so a page that has one calls
 * `signal.addEventListener("abort", () => stream.cancel())`. A failure of the stream, such as an
 * error of the generator, rejects the read of the page with the plain object
 * `{ name, message, code?, data? }` of an `invoke` error. The optional second type argument lists
 * the error types, like that of `invoke`.
 *
 * The generator is slowed down for a page that reads slowly. The page grants the main process a
 * window of `highWaterMark` unread chunks, the main process stops pulling from the generator when
 * the window is used up, and the page grants more as it reads. `cancel()` and errors work while
 * the generator is paused.
 *
 * @example
 * exportRows: stream<(table: string) => AsyncIterable<Row>, DatabaseError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * exportRows: stream() as (table: string) => AsyncIterable<Row>
 */
export function stream<S extends ChannelSignature = never, E extends Error = never>(
   config?: StreamConfig<NoInfer<S>>,
): ChannelResult<S, E>;

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

/**
 * Two-way channel between the main process and a renderer process over a single message port,
 * for high-frequency data such as log tailing, audio meters or progress, which would otherwise
 * pay the overhead of `ipcMain` for every message. The signature must return `void` or
 * `Promise<void>`, and types the messages in both directions.
 *
 * The main process connects a window, a view or contents with `ipc.<name>.connect(target)`, and
 * gets a connection with `send`, `on`, `onReady`, `onClose` and `close`. The renderer has the API
 * of a `port` channel: `send`, `on`, `onReady`, `onClose` and `onConnection`.
 *
 * @example
 * logTail: mainPort<(line: string) => void>()
 */
export function mainPort<S extends ChannelSignature = never>(
   config?: MainPortConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from the main process to a utility process (`utilityProcess.fork`), such
 * as a query to a SQLite database that the child owns. The main process calls
 * `ipc.<name>.invoke(child, ...args)`, where `child` is the `UtilityProcess`, and gets a promise
 * of the answer. The child registers its single handler with `ipc.<name>.handle(callback)` in the
 * generated `utility.ts`, which returns a function that removes it. The signature may return any
 * value, or a promise of it.
 *
 * The promise is rejected with an `IpcUtilityError` that carries the `name`, `message`, `code`
 * and `data` of what the handler threw. The library itself uses the codes `IPC_UTILITY_EXITED`
 * (the child exited, also while the call was pending), `IPC_UTILITY_NO_HANDLER`,
 * `IPC_UTILITY_UNSENDABLE`, `IPC_UTILITY_INVALID_REPLY` and `IPC_UTILITY_TIMEOUT` (see `timeoutMs`
 * of `UtilityCallConfig`).
 *
 * @example
 * indexFile: callUtility<(path: string) => Promise<number>>()
 */
export function callUtility<S extends ChannelSignature = never>(
   config?: UtilityCallConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a utility process. No response is returned. The
 * signature must return `void` or `Promise<void>`. The main process calls
 * `ipc.<name>.send(child, ...args)`, and the child listens with `ipc.<name>.on(callback)` or
 * `once(callback)` in the generated `utility.ts`.
 *
 * @example
 * setLogLevel: notifyUtility<(level: "debug" | "info") => void>()
 */
export function notifyUtility<S extends ChannelSignature = never>(
   config?: UtilityConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from a utility process to the main process. The child calls
 * `ipc.<name>.invoke(...args)` in the generated `utility.ts` and gets a promise of the answer. The
 * main process registers a handler per child with `ipc.<name>.handle(child, callback)`, which
 * returns a function that removes it. The promise is rejected like that of `callUtility`, with
 * an `IpcUtilityError`.
 *
 * @example
 * getSetting: callMain<(key: string) => Promise<string | undefined>>()
 */
export function callMain<S extends ChannelSignature = never>(
   config?: UtilityCallConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from a utility process to the main process. The signature must return `void`
 * or `Promise<void>`. The child calls `ipc.<name>.send(...args)`, and the main process listens
 * per child with `ipc.<name>.on(child, callback)` or `once(child, callback)`.
 *
 * @example
 * progress: notifyMain<(done: number, total: number) => void>()
 */
export function notifyMain<S extends ChannelSignature = never>(
   config?: UtilityConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from a renderer process directly to a utility process, such as a database
 * query of a page, which would otherwise hop through the main process. The main process brokers a
 * `MessageChannelMain` between the window and the child with `ipc.<name>.connect(child, target)`
 * (`target` is a window, a view or contents), which returns `{ close }`. It pairs once the page
 * has loaded, and again on every load, so a page that reloads gets a fresh port. Connecting a
 * channel to a page again replaces the connection. It ends when `close` is called, when the child
 * exits and when the contents are destroyed.
 *
 * The page calls `ipc.<name>.invoke(...args)`. A call made before the main process has connected
 * waits for it. The child registers its single handler with `ipc.<name>.handle(callback)` in the
 * generated `utility.ts`, which returns a function that removes it. The signature may return any
 * value, or a promise of it.
 *
 * The promise is rejected with the plain object `{ name, message, code?, data? }` of what the
 * handler threw, as that of `invoke`. The library itself uses the codes `IPC_UTILITY_EXITED` (the
 * connection closed, also while the call was pending, and a call on a closed connection),
 * `IPC_UTILITY_NO_HANDLER`, `IPC_UTILITY_UNSENDABLE`, `IPC_UTILITY_INVALID_REPLY` and
 * `IPC_UTILITY_TIMEOUT` (see `timeoutMs` of `UtilityPortConfig`). The optional second type argument lists the error types, like that of `invoke`.
 *
 * @example
 * queryRows: invokeUtility<(sql: string) => Promise<Row[]>, DatabaseError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * queryRows: invokeUtility() as (sql: string) => Promise<Row[]>
 */
export function invokeUtility<S extends ChannelSignature = never, E extends Error = never>(
   config?: UtilityPortConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * Stream of results from a utility process directly to a renderer process, with cancellation, over
 * the port that the main process brokers (see `invokeUtility`). The signature takes the arguments
 * of the call and returns an `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or
 * `AsyncGenerator<Chunk>`, and the handler in the child is an `async function*`, registered with
 * `ipc.<name>.handle(callback)` in `utility.ts`.
 *
 * The page calls `ipc.<name>.stream(...args)`, which returns the same async iterator with
 * `cancel()` as that of a `stream` channel. All the streams of a channel share the one port, so
 * the chunks of each carry the ID of its call. A stream that is open when the connection closes
 * fails with `IPC_UTILITY_EXITED`, and the generator in the child is stopped. The generator is
 * slowed down for a page that reads slowly, as for a `stream` channel: see `highWaterMark` of
 * `StreamConfig`. Each call has its own window.
 *
 * @example
 * scanRows: streamUtility<(table: string) => AsyncIterable<Row>, DatabaseError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * scanRows: streamUtility() as (table: string) => AsyncIterable<Row>
 */
export function streamUtility<S extends ChannelSignature = never, E extends Error = never>(
   config?: UtilityStreamConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * Request and response from a service worker to the main process, for a worker that needs the
 * main process for what it cannot do itself (Electron 35 or later, experimental). The signature may
 * return any value, or a promise of it.
 *
 * The worker calls `ipc.<name>.invoke(...args)` from the generated `service-worker-preload.ts`,
 * which `session.registerPreloadScript({ type: "service-worker", filePath })` runs in the worker. The
 * main process registers one handler per session with `ipc.<name>.handle(session, callback)`, which
 * returns a function that removes it. The callback gets an `IpcMainServiceWorkerInvokeEvent`
 * first, which has `serviceWorker`, `versionId` and no `senderFrame`.
 *
 * An error that the handler throws reaches the worker as the plain object
 * `{ name, message, code?, data? }`, like that of `invoke`. The optional second type argument lists
 * the error types, like that of `invoke`.
 *
 * @example
 * getToken: invokeFromWorker<(scope: string) => Promise<string>>()
 */
export function invokeFromWorker<S extends ChannelSignature = never, E extends Error = never>(
   config?: WorkerCallConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * One-way message from a service worker to the main process. The signature must return `void` or
 * `Promise<void>`. The worker calls `ipc.<name>.send(...args)` in the generated
 * `service-worker-preload.ts`, and the main process listens per session with
 * `ipc.<name>.on(session, callback)` or `once(session, callback)`.
 *
 * @example
 * reportSync: sendFromWorker<(done: number) => void>()
 */
export function sendFromWorker<S extends ChannelSignature = never>(
   config?: WorkerCallConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from the main process to a service worker: the main process asks and awaits
 * the answer. Electron has no invoke in this direction, so the generated code sends the request with
 * a correlation ID and the worker answers on a reply channel, like an `ask` channel.
 *
 * The main process calls `ipc.<name>.invoke(worker, ...args)`, or
 * `ipc.<name>.invokeWith(worker, { timeoutMs }, ...args)`, where `worker` is a `ServiceWorkerMain`
 * of a session that `attachServiceWorkers(session)` knows. It gets a promise of the answer, which is
 * rejected with an `IpcAskError` when the worker stops, when the timeout passes, when the worker has
 * no responder and when the responder throws. The worker registers its single responder with
 * `ipc.<name>.handle(callback)`, which returns a function that removes it.
 *
 * @example
 * flushQueue: askWorker<(force: boolean) => number>()
 */
export function askWorker<S extends ChannelSignature = never>(
   config?: WorkerNotifyConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a service worker. The signature must return `void` or
 * `Promise<void>`. The main process calls `ipc.<name>.send(worker, ...args)` to one
 * `ServiceWorkerMain`, or `ipc.<name>.broadcast(session, ...args)` to all the workers of a session
 * that are running. The worker listens with `ipc.<name>.on(callback)` or `once(callback)`.
 *
 * @example
 * configChanged: emitToWorker<(key: string) => void>()
 */
export function emitToWorker<S extends ChannelSignature = never>(
   config?: WorkerNotifyConfig<NoInfer<S>>,
): ChannelResult<S>;
