// The objects the story's passages use. Everything exported here is in scope in passage files.
import { object, randomStream } from "@loominate-if/core";

/** You: the lighthouse keeper. */
export const keeper = object("keeper", {
  /** Whether you've found the matches in the shed. */
  hasMatches: false,
});

/** The lighthouse lamp. */
export const lamp = object("lamp", {
  lit: false,
  /** Days of oil left. Each time you leave the lamp room, it burns a little more. */
  oil: 3,
});

/** What happens out on the water tonight. */
export const night = object("night", {
  /** The ship in danger, chosen when the story begins. */
  ship: "",
  signalled: false,
  /** Whether the ship turned away from the rocks. */
  turned: false,
  logEntries: 0,
});

/** The storm, for whatever's left to chance. */
export const storm = randomStream("storm");

/** The ships that might be out tonight. */
export const SHIPS: readonly string[] = [
  "the Marguerite",
  "the Hollow Bell",
  "the Ansel Grey",
  "the Kestrel",
];
