/**
 * The world model's compiler extension (ADR 0015, ADR 0023): the `room:` tag
 * role. It's plain data, so the world model takes no dependency on the
 * compiler, which checks it when it loads.
 *
 * A passage tagged `[room: cellar]` calls the world model's
 * `enterRoom(cellar)` when the player arrives. The value is code in the
 * game's scope, so TypeScript checks it. Room passages are entered by the
 * world model, through exits (#64), so they're never reported as unreachable.
 */
const extension = {
  name: "@loominate-if/world",
  tagRoles: [
    {
      name: "room",
      entry: true,
      arrival: { module: "@loominate-if/world", export: "enterRoom" },
    },
  ],
};

export default extension;
