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

// The parts of `mock.ts` that do not depend on the schema. They are written with 3-space
// indents, which `reindent` turns into the `codeIndent` of the config. The mock has no
// dependency of its own, so a test needs no mocking library to use it.

/** The type of the stub that the methods of `invoke`, `send` and `stream` channels are. */
export const STUB_TYPE = `/** A function that records its calls, and whose implementation a test can replace. */
export interface Stub<F extends (...args: any[]) => any> {
   (...args: Parameters<F>): ReturnType<F>;
   /** The arguments of every call, in order. */
   calls: Parameters<F>[];
   /** Replaces the implementation, until \`reset()\`. */
   impl(fn: F): void;
   /** Clears the calls, and puts the default implementation back. */
   reset(): void;
}`;

/** The type of the overrides of `createIpcMock`: any part of the API, as the API has it. */
export const DEEP_PARTIAL_TYPE = `/** Any part of \`T\`: the members that are given replace the ones of the mock. */
export type DeepPartial<T> = {
   [K in keyof T]?: T[K] extends (...args: any[]) => any ? T[K] : DeepPartial<T[K]>;
};`;

/** The callback that a method such as `on` or `handle` takes, for the helpers `emit` and `ask`. */
export const CALLBACK_TYPE = `type CallbackOf<M> = M extends (callback: infer C extends (...args: any[]) => any) => any
   ? C
   : never;`;

export const CREATE_STUB = `function createStub<F extends (...args: any[]) => any>(
   fallback: (...args: any[]) => unknown,
): Stub<F> {
   let replacement: ((...args: any[]) => unknown) | undefined;
   const stub = ((...args: any[]) => {
      stub.calls.push(args as Parameters<F>);
      return (replacement ?? fallback)(...args);
   }) as Stub<F>;
   stub.calls = [];
   stub.impl = (fn) => {
      replacement = fn;
   };
   stub.reset = () => {
      stub.calls.length = 0;
      replacement = undefined;
   };
   return stub;
}`;

/** A stream that has no chunks, which is what a `stream` channel returns until a test says otherwise. */
export const EMPTY_STREAM = `function emptyStream(): any {
   const end = () => Promise.resolve({ done: true, value: undefined });
   const stream: any = {
      next: end,
      return: end,
      cancel: () => undefined,
      [Symbol.asyncIterator]: () => stream,
   };
   return stream;
}`;

/**
 * The listeners of an `emit` channel, with the semantics of the preload script: they run in the
 * order of subscription, a `once` listener is removed before it runs, a listener removed during
 * a dispatch is not called by it, a listener that throws is logged and does not stop the others,
 * and the function that `on` returns removes that one subscription, and does nothing when it is
 * called again.
 */
export const CREATE_LISTENERS = `interface Subscriber {
   callback: (...args: any[]) => void;
   once: boolean;
}

function createListeners() {
   const subscribers: Subscriber[] = [];
   const subscribe = (once: boolean) => (callback: (...args: any[]) => void) => {
      const subscriber = { callback, once };
      subscribers.push(subscriber);
      return () => {
         const at = subscribers.indexOf(subscriber);
         if (at >= 0) {
            subscribers.splice(at, 1);
         }
      };
   };
   return {
      on: subscribe(false),
      once: subscribe(true),
      dispatch: (...args: any[]): void => {
         for (const subscriber of subscribers.slice()) {
            const at = subscribers.indexOf(subscriber);
            if (at < 0) {
               continue;
            }
            if (subscriber.once) {
               subscribers.splice(at, 1);
            }
            try {
               subscriber.callback(...args);
            } catch (error) {
               console.error(error);
            }
         }
      },
   };
}`;

/**
 * The responder of an `ask` channel: a new one replaces the previous one, the function that
 * `handle` returns removes only its own, and a question without a responder is rejected with the
 * code that the preload script answers the main process with.
 */
export const CREATE_RESPONDER = `function createResponder(channel: string) {
   let responder: ((...args: any[]) => unknown) | undefined;
   return {
      handle: (callback: (...args: any[]) => unknown) => {
         responder = callback;
         return () => {
            if (responder === callback) {
               responder = undefined;
            }
         };
      },
      ask: async (...args: any[]): Promise<any> => {
         if (!responder) {
            throw Object.assign(new Error(\`No handler is registered for the channel '\${channel}'\`), {
               name: 'IpcAskError',
               code: 'IPC_ASK_NO_HANDLER',
            });
         }
         return responder(...args);
      },
   };
}`;

export const UNAVAILABLE = `function unavailable(): never {
   throw new Error('ports are not mocked');
}`;

export const APPLY_OVERRIDES = `function applyOverrides(target: any, overrides: any): void {
   for (const key of Object.keys(overrides)) {
      const value = overrides[key];
      if (!Object.keys(target).includes(key)) {
         throw new Error(\`The mock has no member '\${key}'\`);
      }
      if (typeof value === 'function' && typeof target[key]?.impl === 'function') {
         target[key].impl(value);
      } else if (typeof value === 'object' && value !== null && typeof target[key] === 'object') {
         applyOverrides(target[key], value);
      } else {
         target[key] = value;
      }
   }
}`;

/** Turns the 3-space indents of a snippet into the indent of the config. */
export function reindent(text: string, codeIndent: number): string {
   return text.replace(/^( {3})+/gm, (spaces) => " ".repeat((spaces.length / 3) * codeIndent));
}
