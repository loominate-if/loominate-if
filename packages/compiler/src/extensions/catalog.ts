/**
 * Which first-party package provides which syntax, so a game that uses
 * `{ask …}` without loading the world model hears which package to install,
 * not just that `ask` is undefined (ADR 0015). Loaded extensions add to it
 * through `suggests`.
 */

const WORLD = "@loominate-if/world";
const VN = "@loominate-if/vn";

/** Syntax this compiler knows belongs to first-party packages. */
export const CATALOG = {
  directive: {
    ask: [WORLD],
    tell: [WORLD],
    give: [WORLD],
    show: [WORLD, VN],
    reveal: [WORLD],
    hide: [VN],
  },
  tagRole: { room: [WORLD], region: [WORLD], actor: [WORLD], state: [WORLD] },
  lineForm: { "@": [VN] },
} as const satisfies Record<string, Record<string, readonly string[]>>;

/** The kinds of syntax a package can provide. */
export type SyntaxKind = keyof typeof CATALOG;

/** The first-party packages that provide `name`, from the catalog. */
export function knownPackages(kind: SyntaxKind, name: string): readonly string[] {
  const table: Record<string, readonly string[] | undefined> = CATALOG[kind];
  return Object.hasOwn(table, name) ? (table[name] ?? []) : [];
}
