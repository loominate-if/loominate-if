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
type Problem = {
  severity: "error" | "warning";
  file: string;
  message: string;
  span: Span;
  unreachable?: true;
};
/** Where a name is used, as the compiler tells checks. */
type NameUse = {
  readonly file: string;
  readonly call?: { readonly callee: string; readonly argument: number };
};
/** What the checks see. */
type Context = {
  readonly files: readonly ParsedFile[];
  readonly start?: string;
  isNamed(name: string): boolean;
  uses(name: string): readonly NameUse[];
};

/**
 * Checks that a room with more than one passage tags exactly one `arrive`,
 * the passage its exits lead to.
 */
function checkRoomPassages(context: Context): Problem[] {
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

/** A plain name, the only kind of room value the check can follow. */
const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;

/**
 * Warns about a room passage no exit leads to, so the player can't reach it
 * (#72). It reads the game's code without running it, so it only warns when
 * it's sure: the room is a plain name; nothing uses that name but its own
 * definition and `connect`'s first argument, the room exits lead *from*; no
 * link or code names the passage; and the game doesn't start there. Any
 * other use, such as `to:`, `moveTo:`, or `move(you, cellar)`, might be a
 * way in.
 */
function checkUnreachableRooms(context: Context): Problem[] {
  const problems: Problem[] = [];
  const warned = new Set<string>();
  for (const f of context.files) {
    for (const p of f.passages) {
      const room = p.tags.find((t) => t.name === "room" && t.value !== undefined);
      const name = room?.value?.trim();
      if (!room || name === undefined || !PLAIN_NAME.test(name) || warned.has(name)) continue;
      if (p.name.name === context.start || context.isNamed(p.name.name)) continue;
      const waysIn = context
        .uses(name)
        .filter((u) => !(u.call?.callee === "connect" && u.call.argument === 0));
      if (waysIn.length > 0) continue;
      warned.add(name);
      problems.push({
        severity: "warning",
        file: f.file,
        unreachable: true,
        message: `No exit leads to the room \`${name}\`, so the player can't reach "${p.name.name}". Connect a room to it in story.ts, as in connect(hall, { north: ${name} }), link to the passage, or start the game here.`,
        span: room.span,
      });
    }
  }
  return problems;
}

// The message parameters grammar.ts registers, copied here because the
// extension imports nothing; parameters.test.ts checks they match (#235).
const pronouns = ["he", "she", "they", "it", "him", "them", "his", "their", "its"];
const reflexives = ["himself", "herself", "themselves", "itself"];
const PARAMETER_NAMES = [
  "the",
  "The",
  "a",
  "A",
  "subj",
  ...[...pronouns, ...reflexives].flatMap((w) => [w, w.charAt(0).toUpperCase() + w.slice(1)]),
];
/** Verbs the verb fallback knows by name, which are never taken for misspelled parameters. */
const KNOWN_VERBS = [
  ...["is", "are", "was", "were", "has", "have", "does", "do", "goes", "go"],
  ...["isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "doesn't", "don't"],
];

/** The topic blocks of actor passages, `{ask letter}` and the rest (#115). */
function topicDirectives() {
  const runtime = { module: WORLD, export: "topicBlock" };
  const scoping = [
    { name: "stays", kind: "choice", choices: ["stays"] },
    { name: "when", kind: "condition", named: true },
    { name: "priority", kind: "expression", named: true },
    { name: "in", kind: "expression", named: true },
    { name: "opens", kind: "expression", named: true },
    { name: "hearMeOut", kind: "passage" },
    { name: "expression", kind: "expression", named: true },
    { name: "reactions", kind: "expression", named: true },
    { name: "then", kind: "expression", named: true },
  ] as const;
  const about = { name: "about", kind: "expression", required: true } as const;
  const again = { name: "again", kind: "choice", choices: ["again"] } as const;
  const takes = { name: "takes", kind: "choice", choices: ["takes"] } as const;
  const suggested = { name: "suggested", kind: "expression", named: true } as const;
  const block = (name: string, example: string, args: readonly object[]) => ({
    name,
    kind: "section" as const,
    roles: ["actor"],
    example,
    args: [...args, ...scoping],
    runtime,
  });
  return [
    block("ask", "{ask letter}", [about, again, suggested]),
    block("tell", "{tell war}", [
      about,
      again,
      suggested,
      { name: "informs", kind: "expression", named: true },
    ]),
    block("ask or tell", "{ask or tell anything}", [about, again, suggested]),
    block("show", "{show photograph}", [about, again, suggested]),
    block("give", "{give locket, takes}", [about, again, takes, suggested]),
    block("show or give", "{show or give cake}", [about, again, takes, suggested]),
    block("yes", "{yes}", [again]),
    block("no", "{no}", [again]),
    block("hello", "{hello}", [
      { name: "implicit", kind: "choice", choices: ["implicit", "explicit"] },
    ]),
    block("bye", "{bye implicit}", [
      { name: "implicit", kind: "choice", choices: ["implicit", "explicit"] },
    ]),
    // Reactions (#142): said after someone else in the conversation answers.
    block("reacts ask", "{reacts ask letter}", [about]),
    block("reacts tell", "{reacts tell war}", [about]),
    block("reacts ask or tell", "{reacts ask or tell letter}", [about]),
    block("reacts show", "{reacts show photograph}", [about]),
    block("reacts give", "{reacts give locket}", [about]),
    block("reacts yes", "{reacts yes}", []),
    block("reacts no", "{reacts no}", []),
  ];
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
    // Actor passages hold an NPC's topic blocks (#115).
    {
      name: "actor",
      entry: true,
      sections: true,
      register: { module: WORLD, export: "registerActorPassage" },
    },
    { name: "state", register: { module: WORLD, export: "registerStatePassage" } },
    { name: "scene", register: { module: WORLD, export: "registerScenePassage" } },
    { name: "node", register: { module: WORLD, export: "registerNodePassage" } },
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
      name: "topics",
      kind: "content",
      example: "{topics}",
      args: [],
      runtime: { module: WORLD, export: "topicLinks" },
    },
    ...topicDirectives(),
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
  checks: [
    { name: "room passages", run: checkRoomPassages },
    { name: "unreachable rooms", run: checkUnreachableRooms },
  ],
  // What grammar.ts registers, so `t` templates' names are checked (#235).
  messageParameters: {
    names: PARAMETER_NAMES,
    fallback: { reads: "a verb", words: KNOWN_VERBS },
  },
};

export default extension;
