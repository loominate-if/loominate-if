import { describe, expect, it } from "vitest";
import { StateError } from "../state/value.js";
import { registry } from "./registry.js";
import { hook } from "./hooks.js";
import { rulebook, traceRules, type RuleRun } from "./rules.js";

let count = 0;
/** A fresh rulebook name for each test, since names are global. */
const fresh = (what: string) => `${what}-${String(count++)}`;

describe("decide rulebooks", () => {
  it("stop at the first rule that decides", () => {
    const canTake = rulebook<{ item: string }, string>(fresh("can-take"), {
      kind: "decide",
      otherwise: () => "taken",
    });
    canTake.rule("fixed-in-place", ({ item }) =>
      item === "statue" ? "It won't budge." : undefined,
    );
    canTake.rule("too-heavy", ({ item }) =>
      item === "statue" || item === "anvil" ? "Too heavy." : undefined,
    );
    expect(canTake.run({ item: "lamp" })).toBe("taken");
    expect(canTake.run({ item: "anvil" })).toBe("Too heavy.");
    expect(canTake.explain({ item: "statue" })).toEqual({
      result: "It won't budge.",
      decidedBy: "fixed-in-place",
      steps: [{ rule: "fixed-in-place", source: "game", outcome: "decided" }],
    });
    expect(canTake.explain({ item: "lamp" })).toEqual({
      result: "taken",
      steps: [
        { rule: "fixed-in-place", source: "game", outcome: "continued" },
        { rule: "too-heavy", source: "game", outcome: "continued" },
      ],
    });
  });

  it("decide nothing without an otherwise, when no rule decides", () => {
    const book = rulebook<number, string>(fresh("maybe"), { kind: "decide" });
    expect(book.run(1)).toBeUndefined();
  });
});

describe("fold rulebooks", () => {
  it("pass a value through each rule, and let one stop the rest", () => {
    const damage = rulebook<number, { strength: number; critical: boolean; immune?: boolean }>(
      fresh("damage"),
      { kind: "fold" },
    );
    damage.rule("strength", (n, { strength }) => n + strength, { source: "@loominate-if/rpg" });
    damage.rule("immunity", (n, { immune }, stop) => (immune ? stop(0) : n));
    damage.rule("critical", (n, { critical }) => (critical ? n * 2 : n));
    expect(damage.run(3, { strength: 2, critical: true })).toBe(10);
    expect(damage.explain(3, { strength: 2, critical: false })).toEqual({
      result: 5,
      steps: [
        { rule: "strength", source: "@loominate-if/rpg", outcome: "changed" },
        { rule: "immunity", source: "game", outcome: "unchanged" },
        { rule: "critical", source: "game", outcome: "unchanged" },
      ],
    });
    expect(damage.explain(3, { strength: 2, critical: true, immune: true })).toMatchObject({
      result: 0,
      decidedBy: "immunity",
      steps: [{ outcome: "changed" }, { rule: "immunity", outcome: "stopped" }],
    });
  });

  it("never mistake a value for a stop", () => {
    const book = rulebook<{ stopped: number }>(fresh("lookalike"), { kind: "fold" });
    book.rule("a", () => ({ stopped: 1 }));
    book.rule("b", (v) => ({ stopped: v.stopped + 1 }));
    expect(book.run({ stopped: 0 }, undefined)).toEqual({ stopped: 2 });
  });
});

describe("rule order", () => {
  const names = (book: { rules(): readonly { name: string }[] }) => book.rules().map((r) => r.name);

  it("follows registration order, then placements, the same way every time", () => {
    const build = () => {
      const book = rulebook<number>(fresh("order"), { kind: "fold" });
      const id = (n: number) => n;
      book.rule("a", id);
      book.rule("b", id);
      book.rule("c", id);
      book.rule("first", id, { before: "a" });
      book.rule("between", id, { after: "a", before: ["c", "b"] });
      book.rule("late", id, { after: "missing-later" });
      book.rule("missing-later", id);
      return names(book);
    };
    const order = build();
    expect(order).toEqual(["first", "a", "between", "b", "c", "missing-later", "late"]);
    expect(build()).toEqual(order);
  });

  it("replaces a rule in place, and records who replaced it", () => {
    const book = rulebook<number>(fresh("replace"), { kind: "fold" });
    book.rule("base", (n) => n + 1, { source: "@loominate-if/rpg" });
    book.rule("bonus", (n) => n + 10);
    book.replace("base", (n) => n + 100, { source: "my-kit" });
    expect(book.run(0, undefined)).toBe(110);
    expect(book.rules()).toEqual([
      { name: "base", source: "@loominate-if/rpg", replacedBy: "my-kit" },
      { name: "bonus", source: "game" },
    ]);
    expect(book.explain(0, undefined).steps[0]).toEqual({
      rule: "base",
      source: "my-kit",
      outcome: "changed",
    });
  });

  it("removes a rule, keeping rules placed relative to it", () => {
    const book = rulebook<number>(fresh("remove"), { kind: "fold" });
    book.rule("a", (n) => n);
    book.rule("b", (n) => n, { before: "a" });
    book.remove("a");
    expect(names(book)).toEqual(["b"]);
    // Adding it again puts it last.
    book.rule("a", (n) => n);
    book.rule("c", (n) => n, { before: "b" });
    expect(names(book)).toEqual(["c", "b", "a"]);
  });

  it("explains placements that can't work", () => {
    const book = rulebook<number>(fresh("broken"), { kind: "fold" });
    book.rule("a", (n) => n, { before: "nope" });
    expect(() => book.rules()).toThrow(
      `the rule "a" is placed before "nope", which isn't in it. Check the name, or that the package adding it loads first.`,
    );
    book.remove("a");
    book.rule("x", (n) => n, { before: "y" });
    book.rule("y", (n) => n, { before: "x" });
    expect(() => book.run(0, undefined)).toThrow(
      `the rules "x", "y" are placed before and after each other.`,
    );
  });
});

describe("rulebook mistakes", () => {
  it("are explained", () => {
    const name = fresh("mistakes");
    const book = rulebook<number>(name, { kind: "fold" });
    book.rule("a", (n) => n);
    expect(() => rulebook(name, { kind: "fold" })).toThrow(
      `rulebook "${name}": there's already one with that name.`,
    );
    expect(() => {
      book.rule("a", (n) => n);
    }).toThrow(`rulebook "${name}": there's already a rule named "a"; use replace() to change it.`);
    expect(() => {
      book.replace("b", (n) => n);
    }).toThrow(`rulebook "${name}": can't replace the rule "b"; it has no rule by that name.`);
    book.remove("a");
    expect(() => {
      book.remove("a");
    }).toThrow(`can't remove the rule "a"; it has no rule by that name. It was removed.`);
    expect(() => {
      book.rule("", (n) => n);
    }).toThrow(StateError);
    expect(() => rulebook("", { kind: "decide" })).toThrow("rulebook: the name must be non-empty.");
  });

  it("name the rule that threw, and its package", () => {
    const name = fresh("throws");
    const book = rulebook<number, number>(name, { kind: "decide" });
    book.rule(
      "divide",
      () => {
        throw new Error("no divisor");
      },
      { source: "@loominate-if/rpg" },
    );
    expect(() => book.run(1)).toThrow(
      `rulebook "${name}", rule "divide" (from @loominate-if/rpg): no divisor`,
    );
  });
});

describe("tracing rules", () => {
  it("reports each run of a rulebook or hook, with what each rule did and its package", () => {
    const canTake = rulebook<string, string>(fresh("can-take"), { kind: "decide" });
    canTake.rule("fixed", (item) => (item === "statue" ? "No." : undefined), { source: "@my/kit" });
    const damage = rulebook<number, undefined>(fresh("damage"), { kind: "fold" });
    damage.rule("double", (v) => v * 2);
    damage.rule("cap", (v, _, stop) => (v > 5 ? stop(5) : v));
    hook("save").rule("note-it", () => undefined, { source: "@my/saves" });

    const runs: RuleRun[] = [];
    const stop = traceRules((run) => runs.push(run));
    try {
      canTake.run("statue");
      damage.run(4, undefined);
      hook("save").run({ slot: "a", summary: {} as never });
      // Explaining isn't playing, so it isn't reported.
      canTake.explain("lamp");
    } finally {
      stop();
      hook("save").remove("note-it");
    }
    expect(runs).toEqual([
      {
        rulebook: canTake.name,
        kind: "decide",
        decidedBy: "fixed",
        steps: [{ rule: "fixed", source: "@my/kit", outcome: "decided" }],
      },
      {
        rulebook: damage.name,
        kind: "fold",
        decidedBy: "cap",
        steps: [
          { rule: "double", source: "game", outcome: "changed" },
          { rule: "cap", source: "game", outcome: "stopped" },
        ],
      },
      {
        rulebook: "save",
        kind: "hook",
        steps: [{ rule: "note-it", source: "@my/saves", outcome: "ran" }],
      },
    ]);
    // Stopped, the listener hears nothing more.
    canTake.run("lamp");
    expect(runs).toHaveLength(3);
  });

  it("never changes how the game plays, even when a listener throws", () => {
    const book = rulebook<number, number>(fresh("score"), { kind: "decide" });
    book.rule("one", () => 1);
    const later: string[] = [];
    const stops = [
      traceRules(() => {
        throw new Error("broken tool");
      }),
      traceRules((run) => later.push(run.rulebook)),
    ];
    try {
      expect(book.run(0)).toBe(1);
      expect(later).toEqual([book.name]);
    } finally {
      for (const s of stops) s();
    }
  });
});

describe("registries", () => {
  it("register, replace, and remove by name, in order, with sources", () => {
    const name = fresh("directions");
    const directions = registry<{ opposite: string }>(name);
    directions.register("north", { opposite: "south" }, { source: "@loominate-if/world" });
    directions.register("south", { opposite: "north" }, { source: "@loominate-if/world" });
    directions.register("spinward", { opposite: "widdershins" });
    directions.replace("north", { opposite: "down" }, { source: "upside-down" });
    directions.remove("south");
    expect(directions.get("north")).toEqual({ opposite: "down" });
    expect(directions.has("south")).toBe(false);
    expect(directions.get("south")).toBeUndefined();
    expect(directions.entries()).toEqual([
      { key: "north", value: { opposite: "down" }, source: "upside-down" },
      { key: "spinward", value: { opposite: "widdershins" }, source: "game" },
    ]);
  });

  it("explain mistakes", () => {
    const name = fresh("widgets");
    const widgets = registry<number>(name);
    widgets.register("compass", 1, { source: "@loominate-if/world" });
    expect(() => {
      widgets.register("compass", 2);
    }).toThrow(
      `registry "${name}": "compass" is already registered by @loominate-if/world; use replace() to substitute it.`,
    );
    expect(() => {
      widgets.replace("map", 2);
    }).toThrow(`registry "${name}": can't replace "map"; nothing is registered under it.`);
    expect(() => {
      widgets.remove("map");
    }).toThrow(/can't remove "map"/);
    expect(() => {
      widgets.register("", 1);
    }).toThrow(`registry "${name}": a key must be non-empty.`);
    expect(() => registry(name)).toThrow(`registry "${name}": there's already one with that name.`);
    expect(() => registry("")).toThrow("registry: the name must be non-empty.");
  });
});
