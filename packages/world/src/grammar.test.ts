import { createEventRecord, createStore, createStory, t, type ObjectRef } from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { actor, place, playAs, startAs, thing } from "./index.js";

const hall = place("hall", { name: "hall" });
// #region grammar
export const door = thing("door", { name: "cellar door", location: hall });
export const apple = thing("apple", { name: "apple", location: hall });
export const coins = thing("coins", { name: "coins", isPlural: true, location: hall });
export const hour = thing("hour", { name: "hour", article: "an" });
export const mira = actor("mira", { body: { name: "Mira", pronoun: "she", location: hall } });
export const sam = actor("sam", { body: { name: "Sam", location: hall } });
// #endregion
const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

describe("articles", () => {
  it("come from the bare name and its grammar", () => {
    // #region articles
    expect(t`{The ${door}} creaks; {a ${apple}} rolls; {a ${coins}} glint.`()).toBe(
      "The cellar door creaks; an apple rolls; some coins glint.",
    );
    expect(t`{A ${door}}, {a ${hour}}, {the ${mira}}.`()).toBe("A cellar door, an hour, Mira.");
    // #endregion
    expect(t`{a ${thing("unicorn", { name: "unicorn" })}}`()).toBe("a unicorn");
  });
});

describe("verbs", () => {
  it("agree with the subject: singular, plural, they, and you", () => {
    // #region agreement
    const falls = (who: ObjectRef) => t`{The subj ${who}} {falls} and {is} gone.`();
    expect(falls(apple)).toBe("The apple falls and is gone.");
    expect(falls(coins)).toBe("The coins fall and are gone.");
    expect(falls(mira)).toBe("Mira falls and is gone.");
    expect(falls(sam)).toBe("Sam falls and is gone.");
    expect(falls(you)).toBe("You fall and are gone.");
    // #endregion
    const they = actor("ash", { body: { name: "Ash", pronoun: "they", location: hall } });
    expect(t`{The subj ${they}} {carries} it. {He} {touches} it.`()).toBe(
      "Ash carries it. They touch it.",
    );
    expect(t`{The subj ${coins}} {doesn't} {go} {wishes}.`()).toBe("The coins don't go wish.");
    expect(t`The door {is ${door}} shut.`()).toBe("The door is shut.");
  });

  it("follow the player: whoever the player is now is you", () => {
    playAs(mira);
    expect(t`{The subj ${mira}} {waits}. {The subj ${sam}} {waits}.`()).toBe(
      "You wait. Sam waits.",
    );
    expect(t`{The subj ${mira.mind}} {waits}.`()).toBe("You wait."); // a mind is named by its body
  });
});

describe("pronouns", () => {
  it("refer to the subject, or to the thing given", () => {
    // #region pronouns
    expect(t`{The subj ${mira}} {picks} up the key. {He} {pockets} it.`()).toBe(
      "Mira picks up the key. She pockets it.",
    );
    expect(t`{The subj ${coins}} spill; you gather {him} into {his ${mira}} purse.`()).toBe(
      "The coins spill; you gather them into her purse.",
    );
    expect(t`{The subj ${you}} {sees} {himself}.`()).toBe("You see yourself.");
    expect(t`{She subj ${sam}} {nods}; {they subj ${coins}} {clink}.`()).toBe(
      "They nod; they clink.",
    );
    // #endregion
  });
});

describe("mistakes", () => {
  it("are explained", () => {
    expect(() => t`{He} waits.`()).toThrow(
      "{He} has no thing and there's no subject yet. Give it one, as in {He ${cat}}, or mark one earlier with subj, as in {The subj ${cat}}.",
    );
    expect(() => t`{the ${door} ${apple}}`()).toThrow(
      "{the} takes `subj` and one thing, as in {the subj ${cat}}; it was given a second value.",
    );
    expect(() => t`{the ${"door"}}`()).toThrow("{the} needs a thing, as in {the ${door}}.");
  });
});
