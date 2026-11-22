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
    /** A continue point's label, when it has none. */
    "page.continue": None;
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
    /** Restart's tooltip while it asks once more. */
    "menu.confirmRestartTip": None;
    /** Restart, asking once more. */
    "menu.confirmRestart": None;
    /** What a screen reader says for the Confirm restart button. */
    "menu.confirmRestartLabel": None;
    /** The start screen's choices. */
    "start.continue": None;
    "start.newGame": None;
    /** A game in progress, on the start screen. */
    "start.inProgress": None;
    /** A game in progress, and where. */
    "start.inProgressAt": { readonly where: string };
    /** A game in progress that this version can't continue. */
    "start.cannotContinue": None;
    /** Which version of the game saved it. */
    "start.savedByVersion": { readonly version: string };
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
register("page.continue", "Continue");
register("page.skip", "Skip");
register("page.storySoFar", "Story so far");
register("history.nextPage", "Next page");
register("history.afterBeat", "After a beat");
register("history.goTo", ({ passage }) => `Go to ${passage}`);
register("status.moves", ({ count }) => `Moves: ${String(count)}`);
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
register("menu.confirmRestartTip", "Click again to start over. Moving away cancels.");
register("menu.confirmRestartLabel", "Confirm restart: start the story over. Saves are kept.");
register("start.continue", "Continue");
register("start.newGame", "New game");
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
