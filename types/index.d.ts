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

import type { Plugin } from "vite";

/**
 * Configuration object for broadcast-type channels.
 *
 * @example
 * { signature: type as (fromCaller: CustomType) => void }
 *
 * @property signature - Common signature of all listener functions, mandatory.
 *    Its value must be defined as: _`type as () => void`_, where the _`type`_
 *    object is imported from this library and the arrow function definition
 *    _`() => void`_ can have any arguments and must have _`void`_ as its return type.
 * @property listeners - An array of callable names for one or multiple listeners
 *    that replace the default listener. Each name must begin with lowercase 'on'.
 */
export interface BroadcastConfig {
   signature: (...args: any[]) => any;
   listeners?: string[];
}

/**
 * Configuration object for unicast-type channels.
 *
 * @example
 * { signature: type as (fromRenderer: CustomType) => string }
 *
 * @property signature - Signature of the handler function, mandatory.
 *    Its value must be defined as: _`type as () => any`_, where the _`type`_
 *    object is imported from this library and the arrow function definition
 *    _`() => any`_ can have any arguments and any _`simple`_ object as its return type.
 */
export interface UnicastConfig {
   signature: (...args: any[]) => any;
}

/**
 * Collection of channel type definitions.
 * Each component of the Channels interface has its own docstring available.
 */
export interface Channels {
   /**
    * One-way channel from one sender to one or multiple listeners.
    * No responses are returned back through the sender to the calling process.
    *
    * @example
    * Channel name: "MainMenuAction"
    * Sender callable: "sendMainMenuAction()"
    * Default listener callable: "onMainMenuAction()"
    */
   Broadcast: {
      /**
       * One-way channel from a renderer process to the main process.
       * No responses are returned back through the sender to the renderer process.
       * A valid BroadcastConfig object must be provided to this function
       * in order to create this IPC channel.
       *
       * @example
       * RendererToMain({
       *    signature: type as (fromRenderer: CustomType) => string
       * });
       */
      RendererToMain: (config: BroadcastConfig) => void;

      /**
       * One-way channel from the main process to a renderer process.
       * No responses are returned back through the sender to the main process.
       * A valid BroadcastConfig object must be provided to this function
       * in order to create this IPC channel.
       *
       * @example
       * MainToRenderer({
       *    signature: type as (fromMain: CustomType) => string
       * });
       */
      MainToRenderer: (config: BroadcastConfig) => void;
   };

   /**
    * One-way channel from one invoker to one handler.
    * Any response from the handler will be returned back
    * through the invoker to the calling process.
    *
    * @example
    * Channel name: "MainMenuAction"
    * Invoker callable: "invokeMainMenuAction()"
    * Handler callable: "handleMainMenuAction()"
    */
   Unicast: {
      /**
       * One-way channel from a renderer process to the main process.
       * Any response from the handler will be returned back through the invoker
       * to the calling renderer process. A valid UnicastConfig object must be
       * provided to this function in order to create this IPC channel.
       *
       * @example
       * RendererToMain({
       *    signature: type as (fromRenderer: CustomType) => string
       * });
       */
      RendererToMain: (config: UnicastConfig) => void;

      /**
       * One-way channel from a renderer process to another renderer process.
       * Any response from the handler will be returned back through the invoker
       * to the calling renderer process. A valid UnicastConfig object must be
       * provided to this function in order to create this IPC channel.
       *
       * @example
       * RendererToRenderer({
       *    signature: type as (fromRenderer: CustomType) => string
       * });
       */
      RendererToRenderer: (config: UnicastConfig) => void;
   };
}

/**
 * Object returned by calling the ipcAutomation() plugin builder function.
 */
export interface IpcAutomationPlugin extends Plugin {
   name: string;
   buildStart: () => Promise<void>;
}

/**
 * Vite plugin for automating the generation of IPC components for Electron apps.
 */
declare module "vite-plugin-automate-electron-ipc" {
   /**
    * Vite plugin which must be used to enable IPC automation for Electron projects.
    * IPC channels are regenerated on Vite server startup and on each hot reload event.
    *
    * @returns An object conforming to the Vite Plugin interface.
    */
   export function ipcAutomation(): IpcAutomationPlugin;

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
