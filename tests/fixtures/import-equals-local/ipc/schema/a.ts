import { defineChannels, invoke } from "automate-electron-ipc";
import * as Models from "../types/models";

// Aliases that are not exported: the generated files use their targets.
import User = Models.User;
import Shapes = Models.Shapes;
import Point = Shapes.Point;

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   getPoint: invoke<(point: Point) => Promise<Shapes.Point>>(),
});
