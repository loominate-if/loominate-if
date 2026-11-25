/**
 * Presentation's messages (#71, ADR 0039): the words of the page, the game
 * menu, the start screen, and the save menu, in core's message table, so a
 * game can reword or translate them.
 */
import { messages } from "@loominate-if/core";

/** No context: the message is about nothing in particular. */
type None = Record<never, never>;
/** A save, by the name the player sees. */
type Named = { readonly name: string };
/** What went wrong, as the error said it. */
type Failure = { readonly error: string };

declare module "@loominate-if/core" {
  interface Messages {
    /** An error the story's code threw during play, shown at the top of the passage. */
    "page.error": { readonly error: string };
    /** Before a line of speech, who said it (#142): "Maid: ". */
    "page.speaker": { readonly name: string };
    /** Before an aside, said to the player alone (#143): "Maid, aside: ". */
    "page.aside": { readonly name: string };
    /** A sound's caption, with captions on (#146): "[A door slams.]". */
    "page.caption": { readonly caption: string };
    /** The Sound dialog (#146): its title, the on switch, each channel's volume, captions, and closing. */
    "sound.title": None;
    "sound.on": None;
    /** The Sound switch's state, shown beside it: "on", "off". */
    "sound.isOn": None;
    "sound.isOff": None;
    "sound.music": None;
    "sound.ambience": None;
    "sound.effects": None;
    "sound.captions": None;
    "sound.close": None;
    /** The game menu's button for the Sound dialog, and its tooltip. */
    "menu.sound": None;
    "menu.soundTip": None;
    /** A continue point's label, when it has none. */
    "page.continue": None;
    /** The heading only screen readers hear, before a passage's text after a move: "Passage". */
    "page.passageHeading": None;
    /** The heading only screen readers hear, before the text a beat revealed: "More". */
    "page.moreHeading": None;
    /** The button that moves past every remaining beat. */
    "page.skip": None;
    /** The story-so-far drawer's label. */
    "page.storySoFar": None;
    /** A move past a page break, in the history. */
    "history.nextPage": None;
    /** A move past a timed beat, in the history. */
    "history.afterBeat": None;
    /** A move straight to a passage, in the history. */
    "history.goTo": { readonly passage: string };
    /** The status line's count of moves. */
    "status.moves": { readonly count: number };
    /** What the compass is, for screen readers. */
    "compass.label": Record<never, never>;
    /** A things widget, such as the inventory, with nothing in it. */
    "things.nothing": None;
    /** A thing's menu with nothing to offer. */
    "menu.nothing": None;
    /** Going back from an action's numbers to its menu. */
    "menu.ask.back": None;
    /** The limit beside a number an action asks for: "of 99". */
    "menu.ask.of": { readonly max: number };
    /** Why a number an action asks for isn't right: "Choose a whole number from 1 to 99." */
    "menu.ask.problem": { readonly min: number; readonly max?: number };
    /** The game menu's buttons. */
    "menu.undo": None;
    "menu.save": None;
    "menu.load": None;
    "menu.restart": None;
    /** The game menu's tooltips, which say what each button does, whatever its label. */
    "menu.undoTip": None;
    /** Undo's tooltip when there's nothing to undo. */
    "menu.cannotUndoTip": None;
    "menu.saveTip": None;
    "menu.loadTip": None;
    "menu.restartTip": None;
    /** The game menu's button for the story log, and its tooltip. */
    "menu.storyLog": None;
    "menu.storyLogTip": None;
    /** The game menu's button for the full transcript, and its tooltip. */
    "menu.transcript": None;
    "menu.transcriptTip": None;
    /** Turning the command line on and off, and its tooltip. */
    "menu.commandLine": None;
    "menu.commandLineTip": None;
    /** The command line's label, and how to use it, for screen readers. */
    "command.label": None;
    "command.help": None;
    /** Why something on offer can't be done, when the game doesn't say. */
    "command.unavailable": None;
    /** The name of its list of suggestions. */
    "command.suggestions": None;
    /** A command that can't be done now: "Open the door: It's locked." */
    "command.cannot": { readonly what: string; readonly why: string };
    /** What's typed could mean several: "Did you mean ask about the weather or ask about the butler?" */
    "command.which": { readonly options: readonly string[] };
    /** What's typed means nothing on offer, and what is: "That isn't something you can do here. You could …" */
    "command.none": { readonly options: readonly string[]; readonly more: boolean };
    /** What the suggestions are, read once typing pauses: "2 suggestions: Ring the bell, Ring for help." */
    "command.shown": { readonly count: number; readonly options: readonly string[] };
    /** The story log's title. */
    "log.title": None;
    /** The full transcript's title. */
    "log.transcriptTitle": None;
    /** The label of the log's filter. */
    "log.show": None;
    /** The story log's filters: everything, or what was said. */
    "log.all": None;
    "log.dialogue": None;
    /** The transcript's filter for every kind of event. */
    "log.allKinds": None;
    /** Copying the transcript, and how it went. */
    "log.copy": None;
    "log.copied": None;
    "log.copyFailed": None;
    /** Exporting the story log: the format's label, the button, and what was saved. */
    "log.exportAs": None;
    "log.export": None;
    "log.exported": { readonly name: string };
    /** An empty log. */
    "log.empty": None;
    /** Closing the log. */
    "log.close": None;
    /** How to move through the log's entries, for screen readers. */
    "log.keys": None;
    /** Restart's tooltip while it asks once more. */
    "menu.confirmRestartTip": None;
    /** Restart, asking once more. */
    "menu.confirmRestart": None;
    /** What a screen reader says for the Confirm restart button. */
    "menu.confirmRestartLabel": None;
    /** The start screen's choices. */
    "start.continue": None;
    "start.newGame": None;
    /** The start screen's choice to load a saved game, when there are saves (#407). */
    "start.load": None;
    /** A game in progress, on the start screen. */
    /** The start screen's byline: "by A. Writer". */
    "start.byline": { readonly author: string };
    "start.inProgress": None;
    /** A game in progress, and where. */
    "start.inProgressAt": { readonly where: string };
    /** A game in progress that this version can't continue. */
    "start.cannotContinue": None;
    /** Which version of the game saved it. */
    "start.savedByVersion": { readonly version: string };
    /** The start screen's choice to start a new game from a seed (#132). */
    "start.newGameSeed": None;
    /** A seed from a link, on the start screen: "A seed shared with you: amber-lantern-fog@1.2.0." */
    "start.shared": { readonly seed: string };
    /** Playing the seed from a link. */
    "start.playShared": None;
    /** The game menu's button for the Seed dialog, and its tooltip. */
    "menu.seed": None;
    "menu.seedTip": None;
    /** The Seed dialog's heading. */
    "seed.title": None;
    /** Before the game's seed, or today's, which everyone shares. */
    "seed.current": None;
    "seed.daily": None;
    /** When no game has begun, so there's no seed yet. */
    "seed.none": None;
    /** Copying the seed, or a link to play it, and how that went. */
    "seed.copy": None;
    "seed.copyLink": None;
    "seed.copied": None;
    "seed.linkCopied": None;
    "seed.copyFailed": None;
    /** The label of the field for a seed to play, its button, and what playing one does. */
    "seed.enter": None;
    "seed.play": None;
    "seed.playNote": None;
    /** A seed made for another version of the game. */
    "seed.otherVersion": { readonly version: string; readonly current: string };
    /** Closing the dialog. */
    "seed.close": None;
    /** The save menu's heading. */
    "saves.title": None;
    /** The label of the name to save under. */
    "saves.name": None;
    /** Saving under that name. */
    "saves.save": None;
    /** The label of the file picker for importing a save. */
    "saves.import": None;
    "saves.close": None;
    "saves.closeLabel": None;
    /** The autosave's name. */
    "saves.autosave": None;
    "saves.empty": None;
    "saves.load": None;
    "saves.loadLabel": Named;
    "saves.saveHere": None;
    "saves.saveHereLabel": Named;
    "saves.export": None;
    "saves.exportLabel": Named;
    "saves.delete": None;
    "saves.deleteLabel": Named;
    "saves.confirmDelete": None;
    "saves.confirmDeleteLabel": Named;
    /** Announced after saving without a name. */
    "saves.saved": None;
    "saves.savedNamed": Named;
    "saves.savedOver": Named;
    "saves.deleted": Named;
    "saves.exported": Named;
    "saves.imported": Named;
    /** A save that can't be loaded, and why. */
    "saves.cantLoad": { readonly problem: string };
    "saves.savedByVersion": { readonly version: string };
    "saves.loadFailed": Failure;
    "saves.saveFailed": Failure;
    "saves.exportFailed": Failure;
    "saves.deleteFailed": Failure;
    "saves.importFailed": Failure;
  }
}

const SOURCE = "@loominate-if/presentation";
const register: typeof messages.register = (key, text) => {
  messages.register(key, text, { source: SOURCE });
};

register("page.error", ({ error }) => `Something went wrong: ${error}`);
register("page.speaker", ({ name }) => `${name}: `);
register("page.aside", ({ name }) => `${name}, aside: `);
register("page.caption", ({ caption }) => `[${caption}]`);
register("sound.title", "Sound");
register("sound.on", "Sound");
register("sound.isOn", "on");
register("sound.isOff", "off");
register("sound.music", "Music");
register("sound.ambience", "Ambience");
register("sound.effects", "Effects");
register("sound.captions", "Show captions for sounds");
register("sound.close", "Close");
register("menu.sound", "Sound");
register("menu.soundTip", "Turn sound on or off, set its volume, and show captions.");
register("page.continue", "Continue");
register("page.passageHeading", "Passage");
register("page.moreHeading", "More");
register("page.skip", "Skip");
register("page.storySoFar", "Story so far");
register("history.nextPage", "Next page");
register("history.afterBeat", "After a beat");
register("history.goTo", ({ passage }) => `Go to ${passage}`);
register("status.moves", ({ count }) => `Moves: ${String(count)}`);
register("compass.label", "Compass");
register("menu.nothing", "Nothing to do with it.");
register("menu.ask.back", "Back");
register("menu.ask.of", ({ max }) => `of ${String(max)}`);
register("menu.ask.problem", ({ min, max }) =>
  max === undefined
    ? `Choose a whole number, ${String(min)} or more.`
    : `Choose a whole number from ${String(min)} to ${String(max)}.`,
);
register("things.nothing", "nothing");
register("menu.undo", "Undo");
register("menu.save", "Save");
register("menu.load", "Load");
register("menu.restart", "Restart");
register("menu.confirmRestart", "Confirm restart");
register("menu.undoTip", "Take back your last move.");
register("menu.cannotUndoTip", "Nothing to undo yet.");
register("menu.saveTip", "Save the game in a slot, to come back to.");
register("menu.loadTip", "Load a saved game, leaving this one.");
register("menu.restartTip", "Start the story over from the beginning. Your saves are kept.");
register("menu.storyLog", "Story log");
register("menu.storyLogTip", "Read the story so far, as a book of your playthrough.");
register("menu.transcript", "Transcript");
register("menu.commandLine", "Command line");
register("menu.commandLineTip", "Type what to do instead of choosing it.");
register("command.label", "What next?");
register(
  "command.help",
  "Type what to do. Suggestions follow; Up and Down pick one, Enter does it.",
);
register("command.suggestions", "Suggestions");
register("command.unavailable", "That can't be done just now.");
register("command.cannot", ({ what, why }) => `${what}: ${why}`);
/** "a", "a or b", "a, b, or c". */
const either = (items: readonly string[]): string =>
  items.length <= 2
    ? items.join(" or ")
    : `${items.slice(0, -1).join(", ")}, or ${items.at(-1) ?? ""}`;
register("command.which", ({ options }) => `Did you mean ${either(options)}?`);
register("command.none", ({ options, more }) =>
  options.length === 0
    ? "That isn't something you can do here, and there's nothing to choose just now."
    : `That isn't something you can do here. You could: ${options.join(", ")}${more ? ", and more" : ""}.`,
);
register("command.shown", ({ count, options }) =>
  count === 0
    ? "No suggestions."
    : `${String(count)} ${count === 1 ? "suggestion" : "suggestions"}: ${options.join(", ")}${
        count > options.length ? `, and ${String(count - options.length)} more` : ""
      }.`,
);
register("menu.transcriptTip", "Every event of the game so far, for testing and bug reports.");
register("log.title", "Story log");
register("log.transcriptTitle", "Transcript");
register("log.show", "Show");
register("log.all", "Everything");
register("log.dialogue", "Dialogue only");
register("log.allKinds", "Every kind");
register("log.copy", "Copy");
register("log.copied", "Copied.");
register("log.copyFailed", "Couldn't copy: select the text and copy it instead.");
register("log.empty", "Nothing yet.");
register("log.close", "Close");
register("log.exportAs", "Export as");
register("log.export", "Export");
register("log.exported", ({ name }) => `Saved ${name}.`);
register("log.keys", "use the up and down arrow keys to read each entry");
register("menu.confirmRestartTip", "Click again to start over. Moving away cancels.");
register("menu.confirmRestartLabel", "Confirm restart: start the story over. Saves are kept.");
register("start.continue", "Continue");
register("start.newGame", "New game");
register("start.load", "Load a saved game");
register("start.byline", ({ author }) => `by ${author}`);
register("start.inProgress", "You have a game in progress.");
register("start.inProgressAt", ({ where }) => `You have a game in progress, at ${where}.`);
register(
  "start.cannotContinue",
  "Your game in progress can't be continued with this version of the game.",
);
register(
  "start.savedByVersion",
  ({ version }) => `It was saved by version ${version} of the game.`,
);
register("start.newGameSeed", "New game with a seed…");
register("start.shared", ({ seed }) => `A seed shared with you: ${seed}.`);
register("start.playShared", "Play this seed");
register("menu.seed", "Seed");
register("menu.seedTip", "This game's seed, which makes its world: to share, or to play another.");
register("seed.title", "Seed");
register("seed.current", "This game's seed:");
register("seed.daily", "Today's seed, the same for everyone:");
register("seed.none", "There's no game in play yet.");
register("seed.copy", "Copy");
register("seed.copyLink", "Copy link");
register("seed.copied", "Seed copied.");
register("seed.linkCopied", "Link copied.");
register("seed.copyFailed", "Couldn't copy it. Select it and copy it yourself.");
register("seed.enter", "Play a seed");
register("seed.play", "Play it");
register("seed.playNote", "Starts a new game from that seed. Save first to keep the game in play.");
register(
  "seed.otherVersion",
  ({ version, current }) =>
    `This seed is from version ${version} of the game. In version ${current}, its world may differ.`,
);
register("seed.close", "Close");
register("saves.title", "Saves");
register("saves.name", "Name");
register("saves.save", "Save");
register("saves.import", "Import a save file");
register("saves.close", "Close");
register("saves.closeLabel", "Close the save menu");
register("saves.autosave", "Autosave");
register("saves.empty", "No saves yet.");
register("saves.load", "Load");
register("saves.loadLabel", ({ name }) => `Load “${name}”`);
register("saves.saveHere", "Save here");
register("saves.saveHereLabel", ({ name }) => `Save over “${name}”`);
register("saves.export", "Export");
register("saves.exportLabel", ({ name }) => `Export “${name}” as a file`);
register("saves.delete", "Delete");
register("saves.deleteLabel", ({ name }) => `Delete “${name}”`);
register("saves.confirmDelete", "Confirm delete");
register("saves.confirmDeleteLabel", ({ name }) => `Confirm deleting “${name}”`);
register("saves.saved", "Saved.");
register("saves.savedNamed", ({ name }) => `Saved “${name}”.`);
register("saves.savedOver", ({ name }) => `Saved over “${name}”.`);
register("saves.deleted", ({ name }) => `Deleted “${name}”.`);
register("saves.exported", ({ name }) => `Exported “${name}”.`);
register("saves.imported", ({ name }) => `Imported “${name}”. Load it from the list.`);
register("saves.cantLoad", ({ problem }) => `Can't be loaded: ${problem}`);
register("saves.savedByVersion", ({ version }) => `Saved by version ${version} of the game.`);
register("saves.loadFailed", ({ error }) => `Loading failed: ${error}`);
register("saves.saveFailed", ({ error }) => `Saving failed: ${error}`);
register("saves.exportFailed", ({ error }) => `Exporting failed: ${error}`);
register("saves.deleteFailed", ({ error }) => `Deleting failed: ${error}`);
register("saves.importFailed", ({ error }) => `Importing failed: ${error}`);
