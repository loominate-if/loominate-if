import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { object, resetObjects, type ObjectRef } from "../objects/objects.js";
import { createStory, type Passage } from "../passages/story.js";
import { createStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { isText, messageFallbacks, messageParameters, t, type MessageArg } from "./text.js";

/** Parameters registered by a test, removed after it, since the registry is global. */
const registered: string[] = [];
function parameter(name: string, fn: Parameters<typeof messageParameters.register>[1]) {
  messageParameters.register(name, fn);
  registered.push(name);
}
afterEach(() => {
  for (const name of registered.splice(0)) messageParameters.remove(name);
  resetObjects();
});

const names: Record<string, string> = { door: "cellar door", lamp: "brass lamp" };
const named = (arg: MessageArg | undefined): string => {
  if (arg?.kind !== "value") throw new Error("expected an object");
  return names[(arg.value as ObjectRef).id] ?? "thing";
};

describe("t", () => {
  it("prints strings, numbers, and other texts", () => {
    const inner = t`the ${"cellar"}`;
    const text = t`Down ${3} steps to ${inner}.`;
    expect(text()).toBe("Down 3 steps to the cellar.");
    expect(t``()).toBe("");
    expect(text.source).toBe("Down ${…} steps to ${…}.");
    expect(isText(text)).toBe(true);
    expect(isText(() => "")).toBe(false);
  });

  it("runs functions each time it renders, with the context", () => {
    let lit = false;
    const status = t`The lamp is ${() => (lit ? "lit" : "dark")}, ${(c) => String(c.who)}.`;
    expect(status({ who: "Ada" })).toBe("The lamp is dark, Ada.");
    lit = true;
    expect(status({ who: "Ada" })).toBe("The lamp is lit, Ada.");
    // Nested texts get the same context.
    expect(t`${t`${(c) => String(c.who)}`}`({ who: "Bo" })).toBe("Bo");
  });

  it("prints literal braces when doubled", () => {
    expect(t`{{a}} and }}{{`()).toBe("{a} and }{");
  });

  it("explains values it can't print", () => {
    const door = object("door", {});
    expect(() => t`It's ${door}.`()).toThrow(
      `text "It's \${…}.": value 1 is an object, which text can't print by itself. Use a message parameter such as {the \${…}} to name it.`,
    );
    const bad = t`${"a"}${() => undefined as unknown as string}`;
    expect(() => bad()).toThrow(
      `value 2 is undefined; text can print strings, numbers, and other texts.`,
    );
    expect(() => t`${true as unknown as string}`()).toThrow("value 1 is the boolean true;");
  });

  it("explains braces that don't match, where the text is written", () => {
    expect(() => t`a } b`).toThrow(
      `text "a } b": a "}" with no "{" before it. Write "}}" to print a brace.`,
    );
    expect(() => t`a {the door`).toThrow(`a "{" with no "}" after it.`);
    expect(() => t`{the {door}}`).toThrow(`a "{" inside a message parameter.`);
    expect(() => t`{ }`).toThrow("a message parameter needs a name first");
    expect(() => t`{${"x"} door}`).toThrow("a message parameter needs a name first");
    expect(() => t`a {the door`).toThrow(StateError);
  });
});

describe("message parameters", () => {
  it("are looked up by name when the text renders, with words and values", () => {
    const door = object("door", {});
    const lamp = object("lamp", {});
    const text = t`{The ${door}} creaks; {the ${() => lamp}} flickers. {echo  two  words ${4}}`;
    // Registered after the text is written: kits may load later.
    parameter("The", ({ args }) => `The ${named(args[0])}`);
    parameter("the", ({ args }) => `the ${named(args[0])}`);
    parameter(
      "echo",
      ({ args, name }) =>
        args.map((a) => (a.kind === "word" ? a.word : `[${String(a.value)}]`)).join("+") +
        `/${name}`,
    );
    expect(text()).toBe("The cellar door creaks; the brass lamp flickers. two+words+[4]/echo");
  });

  it("get the context, so the world model can pass the actor", () => {
    parameter("subj", ({ args, context }) =>
      args[0]?.kind === "word" ? String(context[args[0].word]) : "?",
    );
    expect(t`{subj actor} waits.`({ actor: "Bob" })).toBe("Bob waits.");
  });

  it("share values within one rendering, such as a subject", () => {
    parameter("subj", ({ args, shared }) => {
      shared.set("subject", args[0]?.kind === "word" ? args[0].word : "?");
      return "";
    });
    parameter("who", ({ shared }) => String(shared.get("subject") ?? "nobody"));
    const text = t`{subj Bob}{who} waits; {who} again.`;
    expect(text()).toBe("Bob waits; Bob again.");
    expect(t`{who} waits.`()).toBe("nobody waits."); // each rendering starts afresh
  });

  it("fall back for names nobody registered, such as verbs", () => {
    messageFallbacks.register("shouting", ({ name }) =>
      name === name.toLowerCase() ? name.toUpperCase() : undefined,
    );
    try {
      expect(t`It {opens}.`()).toBe("It OPENS.");
      expect(() => t`{Opens}`()).toThrow("there's no message parameter {Opens}");
    } finally {
      messageFallbacks.remove("shouting");
    }
  });

  it("explain a missing or broken parameter", () => {
    expect(() => t`{teh ${"door"}}`()).toThrow(
      `text "{teh \${…}}": there's no message parameter {teh}. The world model and kits register them; check the name, or write "{{" to print a brace.`,
    );
    parameter("broken", () => 3 as unknown as string);
    expect(() => t`{broken}`()).toThrow(
      "the message parameter {broken} returned a number 3, not a string.",
    );
  });
});

describe("rendering text in a story", () => {
  const play = (passages: Passage[]) => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(store, record, passages, { start: "Hall" });
    return { store, record, story };
  };

  it("shows current state in passages, as object descriptions, and in effects", () => {
    const lamp = object("lamp", {
      isLit: false,
      // Reading the object from its own definition needs the return type written.
      description: t`A brass lamp, ${(): string => (lamp.isLit ? "glowing" : "cold")}.`,
    });
    const passages: Passage[] = [
      {
        id: "Hall",
        tags: [],
        body: () => [
          { type: "text", text: lamp.description() },
          { type: "link", label: "Light it", target: "Lit" },
        ],
      },
      {
        id: "Lit",
        tags: [],
        effects: {
          enter: ({ emit }) => {
            lamp.isLit = true;
            emit("narrative", {
              text: t`The wick ${() => (lamp.isLit ? "catches" : "smokes")}.`(),
            });
          },
        },
        body: () => [{ type: "text", text: lamp.description() }],
      },
    ];
    const { story, record } = play(passages);
    story.begin();
    story.goTo("Lit");
    expect(
      record
        .events()
        .filter((e) => e.kind === "narrative")
        .map((e) => e.text),
    ).toEqual(["A brass lamp, cold.", "The wick catches.", "A brass lamp, glowing."]);
    // A text in a definition is behavior, so it isn't stored as state.
    expect(isText(lamp.description)).toBe(true);
  });

  it("refuses to change state while rendering, even in an effect", () => {
    const lamp = object("lamp", { isLit: false });
    const sneaky = t`${() => {
      lamp.isLit = true;
      return "lit";
    }}`;
    const passages: Passage[] = [
      { id: "Hall", tags: [], body: () => [{ type: "text", text: sneaky() }] },
      {
        id: "Effect",
        tags: [],
        effects: {
          enter: ({ emit }) => {
            emit("narrative", { text: sneaky() });
          },
        },
        body: () => [],
      },
    ];
    const { story } = play(passages);
    expect(() => {
      story.begin();
    }).toThrow(`passage "Hall": rendering tried to change "lamp".isLit.`);
    expect(() => {
      story.goTo("Effect");
    }).toThrow(`text "\${…}": rendering tried to change "lamp".isLit.`);
    expect(lamp.isLit).toBe(false);
  });
});
