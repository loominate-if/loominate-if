/**
 * Core passage syntax, registered through the extension API like any
 * package's (ADR 0004, ADR 0015). `if`/`else` and links are part of the
 * grammar itself, so they aren't registered.
 */
import type { CompilerExtension, RuntimeExport } from "./extension.js";

const core = (name: string): RuntimeExport => ({ module: "@loominate-if/core", export: name });

/** Core's directives: effect phases, continue points, named effects, link guards, line pins, beats, waits, page breaks, storylets, and recorded events. */
export const coreExtension: CompilerExtension = {
  name: "@loominate-if/core",
  directives: [
    { name: "on first visit", kind: "effect", phase: "firstVisit" },
    { name: "on enter", kind: "effect", phase: "enter" },
    { name: "on leave", kind: "effect", phase: "leave" },
    {
      name: "continue",
      kind: "content",
      example: "{continue -> Platform}",
      args: [
        { name: "target", kind: "passage", required: true, unless: ["back"], excludes: ["back"] },
        { name: "back", kind: "choice", choices: ["back"] },
        { name: "label", kind: "expression", named: true },
      ],
      runtime: core("continueTo"),
    },
    {
      name: "effect",
      kind: "content",
      example: "{effect fade}",
      args: [
        { name: "name", kind: "words", required: true },
        { name: "duration", kind: "duration", named: true },
        { name: "options", kind: "expression", named: true },
      ],
      runtime: core("namedEffect"),
    },
    {
      name: "when",
      kind: "guard",
      example: "[[Go down -> Cellar]]{when lantern.isLit}",
      args: [
        { name: "condition", kind: "condition", required: true },
        { name: "mode", kind: "choice", choices: ["hidden", "disabled"], excludes: ["reason"] },
        { name: "reason", kind: "expression", named: true },
      ],
      runtime: core("linkGuard"),
    },
    {
      name: "line",
      kind: "annotation",
      example: "{line drip}",
      args: [{ name: "name", kind: "words", required: true }],
    },
    {
      name: "beat",
      kind: "content",
      example: "{beat 1.5s}",
      args: [
        { name: "duration", kind: "duration", required: true },
        { name: "minutes", kind: "expression", named: true },
      ],
      runtime: core("beat"),
      beat: true,
    },
    {
      name: "wait",
      kind: "content",
      example: "{wait}",
      args: [{ name: "minutes", kind: "expression", named: true }],
      runtime: core("wait"),
      beat: true,
    },
    {
      name: "page",
      kind: "content",
      example: "{page}",
      args: [{ name: "minutes", kind: "expression", named: true }],
      runtime: core("pageBreak"),
      beat: true,
    },
    {
      name: "act",
      kind: "guard",
      example: "[[Open the door]]{act open({ thing: cellarDoor })}",
      args: [{ name: "call", kind: "expression", required: true }],
      runtime: core("actLink"),
      stays: true,
    },
    {
      name: "menu",
      kind: "guard",
      example: "[[brass bell]]{menu bell}",
      args: [{ name: "thing", kind: "expression", required: true }],
      runtime: core("menuLink"),
      stays: true,
    },
    {
      name: "notices",
      kind: "content",
      example: "{notices}",
      runtime: core("notices"),
    },
    {
      name: "storylets",
      kind: "content",
      example: "{storylets evenings, limit: 3}",
      args: [
        { name: "deck", kind: "words" },
        { name: "limit", kind: "expression", named: true },
      ],
      runtime: core("storyletLinks"),
    },
    {
      name: "storylet",
      kind: "arrival",
      example: "{storylet evenings}",
      args: [{ name: "deck", kind: "words" }],
      runtime: core("storyletDraw"),
    },
    {
      name: "emit",
      kind: "arrival",
      example: '{emit "The lamp is lit.", tags: lamp}',
      args: [
        { name: "text", kind: "expression", required: true },
        {
          name: "kind",
          kind: "choice",
          named: true,
          choices: ["system", "narrative", "scene", "dialogue", "action-result"],
        },
        { name: "tags", kind: "words", named: true },
      ],
      runtime: core("emitEvent"),
    },
  ],
};
