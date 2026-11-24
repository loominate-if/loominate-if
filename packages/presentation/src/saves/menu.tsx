/**
 * The save menu (#230): a native `<dialog>` listing a game's save slots, to
 * save to a new or existing slot, load, export as a file, import from one,
 * and delete. A native modal dialog gives focus trapping, Escape to close,
 * and the right semantics for screen readers.
 */
import { message } from "@loominate-if/core";
import { render } from "preact";
import "../messages.js";
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
  const id = `loominate-saves-${String(++menus)}`;
  // The dialog itself is made once, so the shell holds it and opens it as a modal.
  const dialog = doc.createElement("dialog");
  dialog.className = "loominate-saves";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  parent.append(dialog);

  /** The slots, as last listed. */
  let entries: readonly (SaveSummary | UnreadableSave)[] = [];
  /** What the status line says. */
  let status = "";
  /** Slots whose delete was pressed once, asking to be pressed again. */
  const armed = new Set<string>();

  const say = (text: string): void => {
    status = text;
    draw();
  };
  const failed = (
    key:
      | "saves.loadFailed"
      | "saves.saveFailed"
      | "saves.exportFailed"
      | "saves.deleteFailed"
      | "saves.importFailed",
    error: unknown,
  ) => {
    say(message(key, { error: error instanceof Error ? error.message : String(error) }));
  };
  const isUnreadable = (s: SaveSummary | UnreadableSave): s is UnreadableSave => "problem" in s;
  const nameOf = (s: SaveSummary) =>
    s.slot === AUTOSAVE_SLOT ? message("saves.autosave") : (s.label ?? s.passage ?? s.slot);
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
    const a = doc.createElement("a");
    a.href = url;
    a.download = `${gameId}-${nameOf(s).replace(/[^\w-]+/g, "-")}.json`;
    a.click();
    view?.URL.revokeObjectURL(url);
    say(message("saves.exported", { name: nameOf(s) }));
  };

  const refresh = async (): Promise<void> => {
    entries = await saves.list();
    armed.clear();
    draw();
  };

  /** A button, named for screen readers by `label` when it says less than that. */
  const button = (text: string, label: string, onClick: () => void, key?: string) => (
    <button
      key={key}
      type="button"
      {...(label !== text && { "aria-label": label })}
      onClick={onClick}
    >
      {text}
    </button>
  );

  /** A delete button that asks once more before deleting. */
  const confirmDelete = (slot: string, label: string) =>
    armed.has(slot)
      ? button(
          message("saves.confirmDelete"),
          message("saves.confirmDeleteLabel", { name: label }),
          () => {
            saves.delete(slot).then(
              () => {
                say(message("saves.deleted", { name: label }));
                return refresh();
              },
              (e: unknown) => {
                failed("saves.deleteFailed", e);
              },
            );
          },
          "delete",
        )
      : button(
          message("saves.delete"),
          message("saves.deleteLabel", { name: label }),
          () => {
            armed.add(slot);
            draw();
          },
          "delete",
        );

  const row = (s: SaveSummary | UnreadableSave) => {
    if (isUnreadable(s)) {
      return (
        <li key={s.slot} className="loominate-saves-slot">
          <span className="loominate-saves-name">{s.slot}</span>{" "}
          <span className="loominate-saves-problem">
            {message("saves.cantLoad", { problem: s.problem })}
          </span>{" "}
          {confirmDelete(s.slot, s.slot)}
        </li>
      );
    }
    const label = nameOf(s);
    const where = [s.passage, when(s)].filter((x) => x !== undefined).join(", ");
    const separate = (parts: unknown[]) => parts.flatMap((p, i) => (i === 0 ? [p] : [" ", p]));
    return (
      <li key={s.slot} className="loominate-saves-slot">
        <span className="loominate-saves-name">{label}</span>{" "}
        <span className="loominate-saves-meta">{where}</span>
        {!s.sameGameVersion && [
          " ",
          <span key="version" className="loominate-saves-version">
            {message("saves.savedByVersion", { version: s.game.version })}
          </span>,
        ]}{" "}
        <span className="loominate-saves-actions">
          {separate([
            button(
              message("saves.load"),
              message("saves.loadLabel", { name: label }),
              () => {
                actions.load(s.slot).then(close, (e: unknown) => {
                  failed("saves.loadFailed", e);
                });
              },
              "load",
            ),
            ...(s.slot === AUTOSAVE_SLOT
              ? []
              : [
                  button(
                    message("saves.saveHere"),
                    message("saves.saveHereLabel", { name: label }),
                    () => {
                      actions.save(s.slot, s.label ?? label).then(
                        () => {
                          say(message("saves.savedOver", { name: label }));
                          return refresh();
                        },
                        (e: unknown) => {
                          failed("saves.saveFailed", e);
                        },
                      );
                    },
                    "save",
                  ),
                ]),
            button(
              message("saves.export"),
              message("saves.exportLabel", { name: label }),
              () => {
                download(s).catch((e: unknown) => {
                  failed("saves.exportFailed", e);
                });
              },
              "export",
            ),
            ...(s.slot === AUTOSAVE_SLOT ? [] : [confirmDelete(s.slot, label)]),
          ])}
        </span>
      </li>
    );
  };

  const onSave = (event: Event): void => {
    event.preventDefault();
    const input = dialog.querySelector<HTMLInputElement>(`#${id}-name`);
    const label = input?.value.trim() ?? "";
    freeSlot()
      .then(async (slot) => {
        await actions.save(slot, label);
        if (input) input.value = "";
        say(label === "" ? message("saves.saved") : message("saves.savedNamed", { name: label }));
        await refresh();
      })
      .catch((e: unknown) => {
        failed("saves.saveFailed", e);
      });
  };

  const onImport = (event: Event): void => {
    const file = event.currentTarget as HTMLInputElement;
    const chosen = file.files?.[0];
    if (!chosen) return;
    Promise.all([chosen.text(), freeSlot()])
      .then(async ([text, slot]) => {
        const summary = await saves.import(slot, text);
        say(message("saves.imported", { name: nameOf(summary) }));
        await refresh();
      })
      .catch((e: unknown) => {
        failed("saves.importFailed", e);
      })
      .finally(() => {
        file.value = "";
      });
  };

  function draw(): void {
    render(
      <>
        <h2 id={`${id}-title`}>{message("saves.title")}</h2>
        <form className="loominate-saves-new" onSubmit={onSave}>
          <label htmlFor={`${id}-name`}>{`${message("saves.name")} `}</label>
          <input type="text" id={`${id}-name`} autocomplete="off" />{" "}
          <button type="submit">{message("saves.save")}</button>
        </form>
        <p className="loominate-saves-status" role="status">
          {status}
        </p>
        <ul className="loominate-saves-list" aria-labelledby={`${id}-title`}>
          {entries.length === 0 ? (
            <li className="loominate-saves-empty">{message("saves.empty")}</li>
          ) : (
            entries.map(row)
          )}
        </ul>
        <p className="loominate-saves-import">
          <label htmlFor={`${id}-import`}>{`${message("saves.import")} `}</label>
          <input
            type="file"
            accept=".json,application/json"
            id={`${id}-import`}
            onChange={onImport}
          />
        </p>
        {button(message("saves.close"), message("saves.closeLabel"), () => {
          close();
        })}
      </>,
      dialog,
    );
  }

  const close = (): void => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.open = false;
  };

  draw();
  return {
    element: dialog,
    async open(focus) {
      status = "";
      await refresh();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
      const first = dialog.querySelector<HTMLButtonElement>(".loominate-saves-list button");
      (focus === "save" || !first
        ? dialog.querySelector<HTMLInputElement>(`#${id}-name`)
        : first
      )?.focus();
    },
    close,
  };
}
