/**
 * Checks object IDs at compile time (#33, ADR 0006): IDs must be unique, and
 * `gen:` and `$` are reserved.
 *
 * An object definition is any call whose first argument is a string literal
 * and whose result has an `id` of that same literal type, as `object("lantern", …)`
 * returns `Handle<…, "lantern">`. That finds definitions through wrappers such
 * as the world model's `thing()` without the compiler knowing about them.
 */
import ts from "typescript";

/** An object definition found in a module. */
export type ObjectDefinitionSite = {
  readonly id: string;
  readonly file: string;
  /** The ID's string literal, quotes included. */
  readonly start: number;
  readonly end: number;
};

/** A problem with an object ID. */
export type ObjectIdProblem = {
  readonly site: ObjectDefinitionSite;
  readonly message: string;
};

/** Finds object definitions in `files`, in source order. */
export function findObjectDefinitions(
  program: ts.Program,
  files: readonly string[],
): ObjectDefinitionSite[] {
  const checker = program.getTypeChecker();
  const sites: ObjectDefinitionSite[] = [];
  for (const fileName of files) {
    const source = program.getSourceFile(fileName);
    if (!source) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          const idProperty = checker.getTypeAtLocation(node).getProperty("id");
          const idType = idProperty && checker.getTypeOfSymbolAtLocation(idProperty, node);
          if (idType?.isStringLiteral() && idType.value === arg.text) {
            sites.push({ id: arg.text, file: fileName, start: arg.getStart(source), end: arg.end });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

/**
 * Reports reserved IDs, and every definition of an ID that's defined more than
 * once, each pointing at the others. No definition is the "real" one, so none
 * is singled out.
 * @param describe - how to point the author at a definition, e.g. `story.ts:3:28`.
 */
export function checkObjectIds(
  sites: readonly ObjectDefinitionSite[],
  describe: (site: ObjectDefinitionSite) => string,
): ObjectIdProblem[] {
  const problems: ObjectIdProblem[] = [];
  const byId = new Map<string, ObjectDefinitionSite[]>();
  for (const site of sites) byId.set(site.id, [...(byId.get(site.id) ?? []), site]);
  for (const site of sites) {
    if (site.id.startsWith("gen:")) {
      problems.push({
        site,
        message: `Object IDs starting with \`gen:\` are reserved for objects created during play. Choose another ID.`,
      });
    } else if (site.id.startsWith("$")) {
      problems.push({
        site,
        message: `Object IDs starting with \`$\` are reserved for the engine. Choose another ID.`,
      });
    }
    const others = (byId.get(site.id) ?? []).filter((s) => s !== site);
    if (others.length > 0) {
      problems.push({
        site,
        message: `The object ID \`${site.id}\` is also used at ${others.map(describe).join(", ")}. Object IDs must be unique, so give each object its own ID.`,
      });
    }
  }
  return problems;
}
