/**
 * The world model's coverage checks (#133, ADR 0109): facts no one can be
 * asked about, conversation nodes nothing opens, and actions on things
 * that are all out of the world, with what walkthroughs should reach of
 * each, topics too.
 */
import { _actionsOnThings, coverageChecks } from "@loominate-if/core";
import { _allFacts, player } from "./knowledge.js";
import { _allNodes } from "./nodes.js";
import { placeOf, thingFor } from "./things.js";
import { _coverageEntries } from "./topics.js";

const SOURCE = "@loominate-if/world";

/** A fact as the report names it: its name, or its text. */
const factLabel = (f: { readonly text: string; readonly name?: string }): string =>
  f.name ?? `“${f.text}”`;

coverageChecks.register(
  "facts",
  {
    title: "Facts",
    unreachable: () => {
      const about = new Set(
        _coverageEntries()
          .filter((e) => e.kinds.includes("ask") || e.kinds.includes("tell"))
          .map((e) => e.subject),
      );
      return _allFacts()
        .filter((f) => !about.has(`fact:${f.id}`))
        .map((f) => ({
          label: `${factLabel(f)} (${f.id})`,
          why: `No topic is about it, so no one can be asked about it. Give someone a topic about it, as topic(npc, { ask: ${f.id}, says }) or {ask ${f.id}} in an actor passage, if the player should be able to.`,
        }));
    },
    items: () => _allFacts().map((f) => ({ key: `fact:${f.id}`, label: factLabel(f) })),
    reached: () => _allFacts().flatMap((f) => (player.knows(f) ? [`fact:${f.id}`] : [])),
  },
  { source: SOURCE },
);

coverageChecks.register(
  "topics",
  {
    title: "Topics",
    items: () => {
      const entries = _coverageEntries();
      const counted = new Map<string, number>();
      for (const e of entries) counted.set(e.label, (counted.get(e.label) ?? 0) + 1);
      // Entries for the same exchange, in other states or nodes, are told apart by their IDs.
      return entries.map((e) => ({
        key: `topic:${e.id}`,
        label: (counted.get(e.label) ?? 0) > 1 ? `${e.label} (${e.id})` : e.label,
      }));
    },
    reached: () => _coverageEntries().flatMap((e) => (e.answered > 0 ? [`topic:${e.id}`] : [])),
  },
  { source: SOURCE },
);

coverageChecks.register(
  "nodes",
  {
    title: "Conversation nodes",
    unreachable: () => {
      const opened = new Set(_coverageEntries().flatMap((e) => (e.opens ? [e.opens.id] : [])));
      return _allNodes()
        .filter((n) => !opened.has(n.id) && n.openedElsewhere !== true)
        .map((n) => ({
          key: `node:${n.id}`,
          label: `${n.name} (${n.mind})`,
          why: `No topic opens it, so its replies are never heard. Give a topic opens: ${n.name}; if the game opens it with openNode(), give the node openedElsewhere: true.`,
        }));
    },
    items: () => _allNodes().map((n) => ({ key: `node:${n.id}`, label: `${n.name} (${n.mind})` })),
    // A node's been open when one of its replies has answered.
    reached: () =>
      _coverageEntries().flatMap((e) => (e.in && e.answered > 0 ? [`node:${e.in.id}`] : [])),
  },
  { source: SOURCE },
);

coverageChecks.register(
  "actions out of the world",
  {
    title: "Actions",
    // Only actions on world things, all of them out of the world as the game begins.
    unreachable: () =>
      _actionsOnThings()
        .filter((a) => a.on.every((t) => thingFor(t) !== undefined && placeOf(t) === undefined))
        .map((a) => ({
          key: `action:${a.name}`,
          label: a.label,
          why: `It's on ${a.on.map((t) => t.id).join(", ")}, which ${a.on.length === 1 ? "is" : "are"} out of the world when the game begins, so it's never offered. Put ${a.on.length === 1 ? "it" : "one"} somewhere, or move it in during play; a walkthrough that takes the action shows it can be.`,
        })),
  },
  { source: SOURCE },
);
