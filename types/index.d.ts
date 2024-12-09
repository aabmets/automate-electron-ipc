/**
 * Configuration object for unicast-type IPC channels.
 * The signature type supports all TypeScript syntax for function types with
 * any number of arguments. The return type of the function type can be `any`
 * or `Promise<any>` with the exception of Functions, Promises, Symbols,
 * WeakMaps, or WeakSets, which are not supported.
 *
 * @example
 * { signature: type as (arg: any) => any }
 *
 * @property signature - Signature of the handler function, mandatory.
 */
export interface UnicastConfig {
   signature: (...args: any[]) => any;
}

/**
 * Configuration object for broadcast-type IPC channels.
 * The signature type supports all TypeScript syntax for function types with any
 * number of arguments. The return type of the function type must be `void` or
 * `Promise<void>`. If any valid callable names are provided in the listeners array,
 * then listener callback bindings will be generated using these names instead.
 *
 * @example
 * {
 *    signature: type as (arg: any) => void,
 *    listeners: ["onFirstListener", "onSecondListener"]  // optional
 * }
 *
 * @property signature - Common signature of all listener functions, mandatory.
 * @property listeners - An array of callable names for one or multiple listeners
 *    that replace the default listener. Each name must begin with lowercase `on`.
 */
export interface BroadcastConfig {
   signature: (...args: any[]) => any;
   listeners?: string[];
}

/**
 * Configuration object for port-type channels.
 * The signature type supports all TypeScript syntax for function types
 * with any number of arguments. The return type of the function type
 * can be `void` or `Promise<void>`.
 *
 * @example
 * { signature: type as (arg: any) => void }
 *
 * @property signature - Signature of the listener function, mandatory.
 */
export interface PortConfig {
   signature: (...args: any[]) => any;
}

/**
 * Collection of channel type definitions.
 * Each component of the Channels interface has its own docstring available.
 */
export interface Channels {
   /**
    * IPC channel from a renderer process to the main process.
    */
   RendererToMain: {
      /**
       * One-way channel from one invoker to one handler.
       * Any response from the handler will be returned back to the invoker.
       * This function call must be passed a valid `UnicastConfig` object.
       *
       * @example
       * Unicast({
       *    signature: type as (arg: any) => any
       * });
       */
      Unicast: (config: UnicastConfig) => void;

      /**
       * One-way channel from one sender to at least one listener.
       * No responses are returned from listeners back to the caller.
       * This function call must be passed a valid `BroadcastConfig` object.
       *
       * @example
       * Broadcast({
       *    signature: type as (arg: any) => void,
       *    listeners: ["onListenerOne", "onListenerTwo"]  // optional
       * });
       */
      Broadcast: (config: BroadcastConfig) => void;
   };

   /**
    * IPC channel from the main process to a renderer process.
    */
   MainToRenderer: {
      /**
       * One-way channel from one sender to at least one listener.
       * No responses are returned from listeners back to the caller.
       * This function call must be passed a valid `BroadcastConfig` object.
       *
       * @example
       * Broadcast({
       *    signature: type as (arg: any) => void,
       *    listeners: ["onListenerOne", "onListenerTwo"]  // optional
       * });
       */
      Broadcast: (config: BroadcastConfig) => void;
   };

   /**
    * IPC channel from one renderer process to another renderer process.
    */
   RendererToRenderer: {
      /**
       * Two-way channel between two endpoints of a single port.
       * Port listeners receive messages that are sent by sender function calls.
       * This function call must be passed a valid `PortConfig` object.
       *
       * @example
       * Port({
       *    signature: type as (arg: any) => void
       * });
       */
      Port: (config: PortConfig) => void;
   };
}

/**
 * Library for automating the generation of IPC components for Electron apps.
 */
declare module "automate-electron-ipc" {
   /**
    * Defines a channel with the given name, which will be used to
    * generate matching sender and listener or invoker and handler
    * callables for the main and renderer processes.
    *
    * @returns An object with properties of supported channel types,
    *    which must be used to further specify the channel definition.
    */
   export function Channel(name: string): Channels;

   /**
    * This object is used to provide type definitions for values in
    * BroadcastConfig and UnicastConfig objects for IPC automation
    * channel definitions. It must be used as: _`type as xyz`_
    */
   export const type = null as unknown;
}
