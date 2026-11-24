/**
 * Message parameters for English (#70, ADR 0038): articles, pronouns, and
 * verbs that agree with their subject, in core's `t` templates.
 *
 * A thing's `name` is its bare noun, "cellar door", and its grammar says the
 * rest: a proper name takes no article, a plural takes plural verbs, and a
 * pronoun says how to refer to it. The player's current body is "you".
 * `{The subj ${cat}} {sleeps}` marks the subject, and verbs after it, written
 * as for "it", agree with it.
 */
import {
  messageFallbacks,
  messageParameters,
  StateError,
  type MessageCall,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, isBody, isMind } from "./actors.js";
import { ARTICLES, PRONOUN_FORMS } from "./parameters.js";
import { thingFor, type Thing } from "./things.js";

/** How to refer to something: "she", "he", "they", or "it". */
export type Pronoun = "she" | "he" | "they" | "it";

/**
 * What a thing may say about how it's named, beyond its `name`. All are
 * optional, so a thing that says nothing is "the lamp", "a lamp", "it".
 */
export type Grammar = {
  /** A proper name, such as "Mira", which takes no article. Defaults to whether the name starts with a capital. */
  readonly isProper?: boolean;
  /** Whether it's plural, such as "coins": "some coins", "the coins are". */
  readonly isPlural?: boolean;
  /** The indefinite article, when "a" or "an" guessed from the spelling is wrong, as for "an hour". */
  readonly article?: string;
  /** How to refer to it. Defaults to "they" for a plural or a body, such as an actor, and "it" otherwise. */
  readonly pronoun?: Pronoun;
};

/** How a referent is spoken of: its words, and how verbs agree with it. */
type Referent = {
  readonly name: string;
  readonly proper: boolean;
  readonly article: string;
  /** Whether verbs take the plain form after its name: for "you" and plurals. */
  readonly plain: boolean;
  /** Whether verbs take the plain form after its pronoun: for "they" too, as in "Sam falls" but "they fall". */
  readonly plainAsPronoun: boolean;
  /** The words for it, as "she" / "her" / "her" / "herself". */
  readonly pronouns: readonly [string, string, string, string];
  readonly you: boolean;
};

const PRONOUNS: Record<Pronoun | "you", readonly [string, string, string, string]> = {
  she: ["she", "her", "her", "herself"],
  he: ["he", "him", "his", "himself"],
  they: ["they", "them", "their", "themselves"],
  it: ["it", "it", "its", "itself"],
  you: ["you", "you", "your", "yourself"],
};

/** "a" or "an" before `word`, by how it's usually said. */
function indefinite(word: string): string {
  const w = word.toLowerCase();
  if (/^(hour|honest|honou?r|heir)/.test(w)) return "an";
  if (/^(uni|use|usu|eu|one|once|ewe)/.test(w)) return "a";
  return /^[aeiou]/.test(w) ? "an" : "a";
}

/** The thing a parameter's value names: a thing, or a mind's body. */
function thingOf(value: unknown, where: string): Thing {
  const ref = value as ObjectRef | undefined;
  if (typeof ref !== "object" || typeof ref.id !== "string") {
    throw new StateError(`${where} needs a thing, as in {the \${door}}.`);
  }
  const body = isMind(ref) && !thingFor(ref) ? bodyOf(ref) : undefined;
  const found = body ?? thingFor(ref);
  if (!found) {
    throw new StateError(
      `${where}: ${JSON.stringify(ref.id)} isn't defined with thing() or place().`,
    );
  }
  return found;
}

/** How `t` is spoken of. */
function referent(t: Thing): Referent {
  const g = t as Thing & Grammar;
  if (t.id === currentPlayerBody()?.id) {
    return {
      name: "you",
      proper: true,
      article: "",
      plain: true,
      plainAsPronoun: true,
      pronouns: PRONOUNS.you,
      you: true,
    };
  }
  const plural = g.isPlural === true;
  // A person with no pronoun given is "they", never "it".
  const pronoun = g.pronoun ?? (plural || isBody(t) ? "they" : "it");
  return {
    name: t.name,
    proper: g.isProper ?? /^\p{Lu}/u.test(t.name),
    article: g.article ?? (plural ? "some" : indefinite(t.name)),
    plain: plural,
    plainAsPronoun: plural || pronoun === "they",
    pronouns: PRONOUNS[pronoun],
    you: false,
  };
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const SUBJECT = "world:subject";

/**
 * Reads a parameter's arguments: an optional `subj`, which makes its
 * referent the subject later verbs agree with, and at most one value. With
 * no value, it's the subject so far.
 */
function referentOf(call: MessageCall): Referent {
  const where = `{${call.name}}`;
  let marks = false;
  let value: { readonly value: unknown } | undefined;
  for (const a of call.args) {
    if (a.kind === "word" && a.word === "subj") {
      marks = true;
    } else if (value !== undefined) {
      throw new StateError(
        `${where} takes \`subj\` and one thing, as in {${call.name} subj \${cat}}; it was given ${a.kind === "word" ? `"${a.word}"` : "a second value"}.`,
      );
    } else if (a.kind === "value") {
      value = a;
    } else if (Object.hasOwn(call.context, a.word)) {
      // A word names something the text is rendered with, as a library
      // message names what it's about: {The subj door} with { door }.
      value = { value: call.context[a.word] };
    } else {
      const names = Object.keys(call.context);
      throw new StateError(
        `${where}: "${a.word}" isn't something this text is about. ${names.length > 0 ? `It can name ${names.map((n) => `"${n}"`).join(", ")}.` : "It's rendered with nothing to name; give the thing as ${…}."}`,
      );
    }
  }
  if (!value) {
    const subject = call.shared.get(SUBJECT) as Referent | undefined;
    if (!subject) {
      throw new StateError(
        `${where} has no thing and there's no subject yet. Give it one, as in {${call.name} \${cat}}, or mark one earlier with subj, as in {The subj \${cat}}.`,
      );
    }
    return subject;
  }
  const r = referent(thingOf(value.value, where));
  if (marks) call.shared.set(SUBJECT, r);
  return r;
}

/** Writes `text` capitalized when the parameter's name is. */
const cased = (call: MessageCall, text: string): string =>
  /^\p{Lu}/u.test(call.name) ? capital(text) : text;

for (const name of ARTICLES.slice(0, 2)) {
  messageParameters.register(name, (call) => {
    const r = referentOf(call);
    return cased(call, r.proper ? r.name : `the ${r.name}`);
  });
}
for (const name of ARTICLES.slice(2, 4)) {
  messageParameters.register(name, (call) => {
    const r = referentOf(call);
    return cased(call, r.proper || r.article === "" ? r.name : `${r.article} ${r.name}`);
  });
}
messageParameters.register("subj", (call) => {
  referentOf({ ...call, args: [{ kind: "word", word: "subj" }, ...call.args] });
  return "";
});
// Each form, by any of the words for it (parameters.ts).
const forms = PRONOUN_FORMS;
for (const [form, index] of Object.entries(forms)) {
  for (const name of [form, capital(form)]) {
    messageParameters.register(name, (call) => {
      const r = referentOf(call);
      // A subject pronoun is the subject from here on, and verbs agree with
      // the pronoun: "Sam waits. They nod."
      const marks =
        call.args.length === 0 || call.args.some((a) => a.kind === "word" && a.word === "subj");
      if (index === 0 && marks) call.shared.set(SUBJECT, { ...r, plain: r.plainAsPronoun });
      return cased(call, r.pronouns[index] ?? "");
    });
  }
}

/** The plain form of `verb`, written for "it": "is" → "are", "carries" → "carry". */
function plainForm(verb: string): string {
  const irregular: Record<string, string> = {
    is: "are",
    was: "were",
    has: "have",
    does: "do",
    goes: "go",
    "isn't": "aren't",
    "wasn't": "weren't",
    "hasn't": "haven't",
    "doesn't": "don't",
  };
  const known = irregular[verb];
  if (known) return known;
  if (/[^aeiou]ies$/.test(verb)) return `${verb.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z|o)es$/.test(verb)) return verb.slice(0, -2);
  if (verb.endsWith("s") && !verb.endsWith("ss")) return verb.slice(0, -1);
  return verb;
}

// Verbs: any name nobody registered that's a word, written as for "it",
// agreeing with the thing it's given or the subject so far.
messageFallbacks.register("verbs", (call) => {
  if (!/^\p{L}[\p{L}']*$/u.test(call.name)) return undefined;
  const r = referentOf(call);
  const verb = call.name.toLowerCase();
  const form = r.plain ? plainForm(verb) : verb;
  return cased(call, form);
});
