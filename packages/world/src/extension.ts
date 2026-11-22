/**
 * The world model's compiler extension (ADR 0015, ADR 0023): the `room:` tag
 * role, the `{exits}` and `{reveal}` directives, and a check that every room's exits know
 * which passage to lead to. It's plain data, so the world model takes no
 * dependency on the compiler, which checks it when it loads.
 *
 * A passage tagged `[room: cellar]` registers itself for `cellar` when the
 * game loads, and calls the world model's `enterRoom(cellar)` when the
 * player arrives. The value is code in the game's scope, so TypeScript
 * checks it. Room passages are entered by exits, so they're never reported
 * as unreachable.
 */
const WORLD = "@loominate-if/world";

/** Where something is in a passage file, as the compiler gives it. */
type Span = { readonly start: number; readonly end: number };
/** The parts of a parsed passage file the check reads. */
type ParsedFile = {
  readonly file: string;
  readonly passages: readonly {
    readonly name: { readonly name: string };
    readonly tags: readonly {
      readonly name: string;
      readonly value?: string;
      readonly span: Span;
    }[];
  }[];
};
/** A problem the check reports. */
type Problem = { severity: "error"; file: string; message: string; span: Span };

/**
 * Checks that a room with more than one passage tags exactly one `arrive`,
 * the passage its exits lead to.
 */
function checkRoomPassages(context: { readonly files: readonly ParsedFile[] }): Problem[] {
  const rooms = new Map<string, { file: string; passage: string; span: Span; arrive: boolean }[]>();
  for (const f of context.files) {
    for (const p of f.passages) {
      const room = p.tags.find((t) => t.name === "room" && t.value !== undefined);
      if (!room?.value) continue;
      const list = rooms.get(room.value) ?? [];
      list.push({
        file: f.file,
        passage: p.name.name,
        span: room.span,
        arrive: p.tags.some((t) => t.name === "arrive" && t.value === undefined),
      });
      rooms.set(room.value, list);
    }
  }
  const problems: Problem[] = [];
  for (const [room, list] of rooms) {
    if (list.length < 2) continue;
    const arrivals = list.filter((p) => p.arrive);
    if (arrivals.length === 1) continue;
    const names = list.map((p) => `"${p.passage}"`).join(", ");
    const message =
      arrivals.length === 0
        ? `The room \`${room}\` is described by ${String(list.length)} passages, ${names}. Tag the one its exits lead to with \`arrive\`, as in \`[room: ${room}, arrive]\`.`
        : `The room \`${room}\` has ${String(arrivals.length)} passages tagged \`arrive\`. Tag only the one its exits lead to.`;
    for (const p of arrivals.length === 0 ? list : arrivals) {
      problems.push({ severity: "error", file: p.file, message, span: p.span });
    }
  }
  return problems;
}

const extension = {
  name: WORLD,
  tagRoles: [
    {
      name: "room",
      entry: true,
      arrival: { module: WORLD, export: "enterRoom" },
      register: { module: WORLD, export: "registerRoom" },
    },
  ],
  directives: [
    {
      name: "exits",
      kind: "content",
      roles: ["room"],
      example: "{exits}",
      args: [],
      runtime: { module: WORLD, export: "exitLinks" },
    },
    {
      name: "reveal",
      kind: "arrival",
      example: "{reveal facts.butlerTookLetter, from: maid}",
      args: [
        { name: "fact", kind: "expression", required: true },
        { name: "from", kind: "expression", named: true },
      ],
      runtime: { module: WORLD, export: "reveal" },
    },
  ],
  checks: [{ name: "room passages", run: checkRoomPassages }],
};

export default extension;
