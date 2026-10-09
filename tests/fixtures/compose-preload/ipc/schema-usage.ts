// Not a schema: it composes the generated preload the way an application would, so that the
// type-check fails when `api` or `expose` are not exported.
import { api, expose } from "./preload";

export const exposedNames: string[] = Object.keys(api);
expose();
expose("second");
