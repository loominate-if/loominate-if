/**
 * Core passage syntax, registered through the extension API like any
 * package's (ADR 0004, ADR 0015). `if`/`else` and links are part of the
 * grammar itself, so they aren't registered.
 */
import type { CompilerExtension, RuntimeExport } from "./extension.js";

const core = (name: string): RuntimeExport => ({ module: "@loominate-if/core", export: name });

/** Core's directives: effect phases, continue points, named effects, link guards, line pins, and beats. */
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
        { name: "target", kind: "passage", required: true },
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
      args: [{ name: "duration", kind: "duration", required: true }],
      unsupported: "it arrives with beats and cut scenes (#41)",
    },
    {
      name: "wait",
      kind: "content",
      example: "{wait}",
      unsupported: "it arrives with beats and cut scenes (#41)",
    },
  ],
};
