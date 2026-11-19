/**
 * The save menu (#230): a native `<dialog>` listing a game's save slots, to
 * save to a new or existing slot, load, export as a file, import from one,
 * and delete. A native modal dialog gives focus trapping, Escape to close,
 * and the right semantics for screen readers.
 */
import {
  AUTOSAVE_SLOT,
  type SaveSummary,
  type Saves,
  type UnreadableSave,
} from "@loominate-if/core";

/** What the save menu does with the game it's for, supplied by the player shell. */
export type SaveMenuActions = {
  /** Saves the game as it is now. */
  save(slot: string, label: string): Promise<unknown>;
  /** Loads a slot, replacing the game in play. */
  load(slot: string): Promise<void>;
};

/** An open-able save menu. */
export type SaveMenu = {
  /** The dialog element. */
  readonly element: HTMLDialogElement;
  /** Opens the menu, focusing the new save's name (`save`) or the first slot to load (`load`). */
  open(focus: "save" | "load"): Promise<void>;
  /** Closes it. */
  close(): void;
};

let menus = 0;

/** Builds a save menu over `saves`, added to `parent`. */
export function createSaveMenu(
  parent: HTMLElement,
  saves: Saves,
  gameId: string,
  actions: SaveMenuActions,
): SaveMenu {
  const doc = parent.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text: string, label: string, onClick: () => void, className?: string) => {
    const b = el("button", className, text);
    b.type = "button";
    if (label !== text) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  };
  const id = `loominate-saves-${String(++menus)}`;

  const dialog = el("dialog", "loominate-saves");
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  const title = el("h2", undefined, "Saves");
  title.id = `${id}-title`;

  const form = el("form", "loominate-saves-new");
  const nameLabel = el("label", undefined, "Name ");
  const name = el("input");
  name.type = "text";
  name.id = `${id}-name`;
  name.autocomplete = "off";
  nameLabel.htmlFor = name.id;
  const saveNew = el("button", undefined, "Save");
  saveNew.type = "submit";
  form.append(nameLabel, name, " ", saveNew);

  const status = el("p", "loominate-saves-status");
  status.setAttribute("role", "status");
  const list = el("ul", "loominate-saves-list");
  list.setAttribute("aria-labelledby", `${id}-title`);

  const importLabel = el("label", undefined, "Import a save file ");
  const file = el("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.id = `${id}-import`;
  importLabel.htmlFor = file.id;
  const closeButton = button("Close", "Close the save menu", () => {
    close();
  });
  const importing = el("p", "loominate-saves-import");
  importing.append(importLabel, file);
  dialog.append(title, form, status, list, importing, closeButton);
  parent.append(dialog);

  const say = (text: string) => {
    status.textContent = text;
  };
  const failed = (what: string, error: unknown) => {
    say(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  };
  const isUnreadable = (s: SaveSummary | UnreadableSave): s is UnreadableSave => "problem" in s;
  const nameOf = (s: SaveSummary) =>
    s.slot === AUTOSAVE_SLOT ? "Autosave" : (s.label ?? s.passage ?? s.slot);
  const when = (s: SaveSummary) => {
    const at = Date.parse(s.savedAt);
    return Number.isNaN(at)
      ? s.savedAt
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at);
  };

  /** The next unused slot name, `save-1`, `save-2`, … */
  const freeSlot = async (): Promise<string> => {
    const used = new Set((await saves.list()).map((s) => s.slot));
    let n = 1;
    while (used.has(`save-${String(n)}`)) n++;
    return `save-${String(n)}`;
  };

  const download = async (s: SaveSummary) => {
    const text = await saves.export(s.slot);
    if (text === undefined) return;
    const view = doc.defaultView;
    const url = view?.URL.createObjectURL(new Blob([text], { type: "application/json" }));
    if (url === undefined) return;
    const a = el("a");
    a.href = url;
    a.download = `${gameId}-${nameOf(s).replace(/[^\w-]+/g, "-")}.json`;
    a.click();
    view?.URL.revokeObjectURL(url);
    say(`Exported “${nameOf(s)}”.`);
  };

  const row = (s: SaveSummary | UnreadableSave): HTMLLIElement => {
    const item = el("li", "loominate-saves-slot");
    if (isUnreadable(s)) {
      item.append(el("span", "loominate-saves-name", s.slot), " ");
      item.append(el("span", "loominate-saves-problem", `Can't be loaded: ${s.problem}`), " ");
      item.append(confirmDelete(s.slot, s.slot));
      return item;
    }
    const label = nameOf(s);
    item.append(el("span", "loominate-saves-name", label), " ");
    const where = [s.passage, when(s)].filter((x) => x !== undefined).join(", ");
    item.append(el("span", "loominate-saves-meta", where));
    if (!s.sameGameVersion) {
      item.append(
        " ",
        el("span", "loominate-saves-version", `Saved by version ${s.game.version} of the game.`),
      );
    }
    const controls = el("span", "loominate-saves-actions");
    controls.append(
      button("Load", `Load “${label}”`, () => {
        actions.load(s.slot).then(close, (e: unknown) => {
          failed("Loading", e);
        });
      }),
    );
    if (s.slot !== AUTOSAVE_SLOT) {
      controls.append(
        " ",
        button("Save here", `Save over “${label}”`, () => {
          actions.save(s.slot, s.label ?? label).then(
            () => {
              say(`Saved over “${label}”.`);
              return refresh();
            },
            (e: unknown) => {
              failed("Saving", e);
            },
          );
        }),
      );
    }
    controls.append(
      " ",
      button("Export", `Export “${label}” as a file`, () => {
        download(s).catch((e: unknown) => {
          failed("Exporting", e);
        });
      }),
    );
    if (s.slot !== AUTOSAVE_SLOT) controls.append(" ", confirmDelete(s.slot, label));
    item.append(" ", controls);
    return item;
  };

  /** A delete button that asks once more before deleting. */
  const confirmDelete = (slot: string, label: string): HTMLButtonElement => {
    let armed = false;
    const b = button("Delete", `Delete “${label}”`, () => {
      if (!armed) {
        armed = true;
        b.textContent = "Confirm delete";
        b.setAttribute("aria-label", `Confirm deleting “${label}”`);
        return;
      }
      saves.delete(slot).then(
        () => {
          say(`Deleted “${label}”.`);
          return refresh();
        },
        (e: unknown) => {
          failed("Deleting", e);
        },
      );
    });
    return b;
  };

  const refresh = async (): Promise<void> => {
    const all = await saves.list();
    list.replaceChildren(...all.map(row));
    if (all.length === 0) list.append(el("li", "loominate-saves-empty", "No saves yet."));
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const label = name.value.trim();
    freeSlot()
      .then(async (slot) => {
        await actions.save(slot, label);
        name.value = "";
        say(label === "" ? "Saved." : `Saved “${label}”.`);
        await refresh();
      })
      .catch((e: unknown) => {
        failed("Saving", e);
      });
  });

  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    Promise.all([chosen.text(), freeSlot()])
      .then(async ([text, slot]) => {
        const summary = await saves.import(slot, text);
        say(`Imported “${nameOf(summary)}”. Load it from the list.`);
        await refresh();
      })
      .catch((e: unknown) => {
        failed("Importing", e);
      })
      .finally(() => {
        file.value = "";
      });
  });

  const close = (): void => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.open = false;
  };

  return {
    element: dialog,
    async open(focus) {
      say("");
      await refresh();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
      const first = list.querySelector<HTMLButtonElement>("button");
      (focus === "save" || !first ? name : first).focus();
    },
    close,
  };
}
