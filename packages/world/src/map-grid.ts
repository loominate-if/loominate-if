/**
 * Rooms on a grid by their exits' compass directions (#426, ADR 0124),
 * north up and east right, for the story map's Rooms view and the auto-map
 * (#394). It's plain data in and out, so it's the same wherever it's drawn.
 */

/** A grid cell: x to the right, y down. */
export type GridCell = { readonly x: number; readonly y: number };

/** An exit, as the layout reads it. */
export type GridExit = {
  readonly from: string;
  readonly to: string;
  /** Its direction's name, as `north`. Others than the eight compass points have no cell of their own. */
  readonly direction: string;
};

/** Where {@link gridLayout} put each room. */
export type GridLayout = {
  /** Each room's cell, by its ID. */
  readonly cells: ReadonlyMap<string, GridCell>;
  /** The indexes of the exits that don't run one step in their direction, to draw bent. */
  readonly bent: ReadonlySet<number>;
  /** Rooms moved off the cell their exit asked for, because another room was there. */
  readonly nudged: readonly string[];
};

/** Each compass direction's step on the grid. */
const STEPS: Readonly<Record<string, GridCell>> = {
  north: { x: 0, y: -1 },
  northeast: { x: 1, y: -1 },
  east: { x: 1, y: 0 },
  southeast: { x: 1, y: 1 },
  south: { x: 0, y: 1 },
  southwest: { x: -1, y: 1 },
  west: { x: -1, y: 0 },
  northwest: { x: -1, y: -1 },
};

/**
 * Where a room reached by a way that isn't a compass point goes, beside the
 * room it's reached from, so up, down, in, and out don't crowd one cell.
 */
const BESIDE: Readonly<Record<string, GridCell>> = {
  up: { x: 1, y: -1 },
  down: { x: 1, y: 1 },
  in: { x: -1, y: -1 },
  out: { x: -1, y: 1 },
};

/**
 * Which way an exit in `direction` points on the grid, one cell's step, and
 * whether it's a compass point; others point to the diagonal their room
 * goes beside. @internal
 */
export function _gridStep(direction: string): GridCell & { readonly compass: boolean } {
  const step = STEPS[direction];
  if (step) return { ...step, compass: true };
  return { ...(BESIDE[direction] ?? { x: 1, y: 0 }), compass: false };
}

const key = (c: GridCell): string => `${String(c.x)},${String(c.y)}`;
const add = (a: GridCell, b: GridCell): GridCell => ({ x: a.x + b.x, y: a.y + b.y });

/**
 * The free cells around `around`, nearest first, in a fixed order: the cell
 * itself, then each ring outward, clockwise from the north.
 */
function* nearby(around: GridCell): Generator<GridCell> {
  yield around;
  for (let r = 1; ; r++) {
    const ring: GridCell[] = [];
    for (let x = -r; x <= r; x++) ring.push({ x, y: -r });
    for (let y = -r + 1; y <= r; y++) ring.push({ x: r, y });
    for (let x = r - 1; x >= -r; x--) ring.push({ x, y: r });
    for (let y = r - 1; y > -r; y--) ring.push({ x: -r, y });
    // Nearest first within the ring, keeping the clockwise order among equals.
    ring.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    for (const c of ring) yield add(around, c);
  }
}

/**
 * Lays rooms out on a grid: the start at (0, 0), then each room one step from
 * the room it's first reached from, in its exit's direction, walking the
 * exits breadth first. A room whose cell is taken goes to the nearest free
 * one, and is listed as nudged. Exits that aren't compass points, as `up`,
 * put their room in the nearest free cell. Rooms not reached from the start
 * are laid out the same way, to the right of the rest. Exits that don't run
 * one step in their direction are listed as bent.
 *
 * Pinned rooms are in their cells, whatever their exits say, and the
 * rest fit around them; the layout walks on from a pinned room as from any.
 *
 * The same rooms and exits, in the same order, always give the same layout.
 */
export function gridLayout(
  rooms: readonly string[],
  exits: readonly GridExit[],
  start?: string,
  pins: ReadonlyMap<string, GridCell> = new Map(),
): GridLayout {
  const cells = new Map<string, GridCell>();
  const taken = new Map<string, string>();
  const nudged: string[] = [];
  const place = (room: string, cell: GridCell): void => {
    cells.set(room, cell);
    taken.set(key(cell), room);
  };
  const free = (wanted: GridCell): GridCell => {
    for (const c of nearby(wanted)) if (!taken.has(key(c))) return c;
    return wanted;
  };
  // The exits out of each room, and those into it, as ways to reach a room from one already placed.
  const ways = new Map<string, { other: string; step?: GridCell; beside: GridCell }[]>();
  const way = (room: string, other: string, step: GridCell | undefined, beside: GridCell) => {
    ways.set(room, [...(ways.get(room) ?? []), { other, ...(step && { step }), beside }]);
  };
  const flip = (c: GridCell): GridCell => ({ x: -c.x, y: -c.y });
  // A room's own exits first, then other rooms' exits into it, so `up` puts the room above it, not below.
  for (const e of exits)
    way(e.from, e.to, STEPS[e.direction], BESIDE[e.direction] ?? { x: 1, y: 0 });
  for (const e of exits) {
    const step = STEPS[e.direction];
    way(e.to, e.from, step && flip(step), flip(BESIDE[e.direction] ?? { x: 1, y: 0 }));
  }
  const known = new Set(rooms);
  // Pinned rooms first: they're where the author says, and the rest fit around them.
  for (const [room, cell] of pins) if (known.has(room)) place(room, cell);
  // Rooms walked from: each is reached once, pinned or not, and its exits followed from there.
  const walked = new Set<string>();
  const order = [...(start !== undefined && known.has(start) ? [start] : []), ...rooms];
  for (const root of order) {
    if (walked.has(root)) continue;
    if (!cells.has(root)) {
      // A new group: the start at the origin, the rest to the right of what's placed.
      const right =
        root === start || cells.size === 0
          ? 0
          : Math.max(...[...cells.values()].map((c) => c.x)) + 2;
      const top =
        root === start || cells.size === 0 ? 0 : Math.min(...[...cells.values()].map((c) => c.y));
      place(root, free({ x: right, y: top }));
    }
    walked.add(root);
    const group = [root];
    /** Reaches `other` from a room: places it where it's wanted, unless it's placed already. */
    const reach = (other: string, wanted: GridCell, compass: boolean): void => {
      walked.add(other);
      group.push(other);
      if (cells.has(other)) return;
      const cell = free(wanted);
      if (compass && key(cell) !== key(wanted)) nudged.push(other);
      place(other, cell);
    };
    // Compass exits first, so a room up a ladder doesn't take a cell a room to the east should have.
    const walk = (queue: string[]): void => {
      for (let room = queue.shift(); room !== undefined; room = queue.shift()) {
        const at = cells.get(room);
        if (!at) continue;
        for (const { other, step } of ways.get(room) ?? []) {
          if (!step || walked.has(other) || !known.has(other)) continue;
          reach(other, add(at, step), true);
          queue.push(other);
        }
      }
    };
    walk([root]);
    // Then each room reached only another way, beside the room it's reached from, and on from there.
    for (let i = 0; i < group.length; i++) {
      const at = cells.get(group[i] ?? "");
      if (!at) continue;
      for (const { other, step, beside } of ways.get(group[i] ?? "") ?? []) {
        if (step || walked.has(other) || !known.has(other)) continue;
        reach(other, add(at, beside), false);
        walk([other]);
      }
    }
  }
  const bent = new Set<number>();
  exits.forEach((e, i) => {
    const step = STEPS[e.direction];
    const from = cells.get(e.from);
    const to = cells.get(e.to);
    if (!step || !from || !to || key(add(from, step)) !== key(to)) bent.add(i);
  });
  return { cells, bent, nudged };
}
