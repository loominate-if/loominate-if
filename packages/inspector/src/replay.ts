/**
 * The Replay panel (#50): opens a replay file, such as one attached to a bug
 * report, and steps through it. The replay is played into a new game as moves
 * in the undo history, then the game goes back to its start, so Next and Back
 * (or the History panel) step through it exactly as it was played.
 */
import { ENGINE_VERSION, readReplay, writeReplay, type Replay } from "@loominate-if/core";
import type { PlayedReplay, Player } from "@loominate-if/presentation";
import type { InspectorPanel } from "./panels.js";

/** A replay opened in the panel, and what came of playing it. */
type Opened = {
  readonly name: string;
  readonly replay: Replay;
  readonly played: PlayedReplay;
  /** The game the replay was played into, so a new or loaded game ends it. */
  readonly story: Player["story"];
};

/** The panel that opens replay files and steps through them. */
export const replay: InspectorPanel = {
  title: "Replay",
  mount(element, { player }) {
    const doc = element.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className?: string,
      text?: string,
    ) => {
      const node = doc.createElement(tag);
      if (className !== undefined) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (text: string, onClick: () => void) => {
      const b = el("button", "action", text);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    };

    let opened: Opened | undefined;
    let problem: string | undefined;
    // One status line for the panel's life, so screen readers hear it change.
    const head = el("p", "replay-status");
    head.tabIndex = -1;
    head.setAttribute("role", "status");
    const rest = el("div");

    const file = el("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.hidden = true;
    file.addEventListener("change", () => {
      const chosen = file.files?.[0];
      file.value = "";
      if (chosen) void open(chosen);
    });

    const open = async (chosen: File) => {
      try {
        const read = readReplay(await chosen.text());
        const played = player.playReplay(read);
        opened = { name: chosen.name, replay: read, played, story: player.story };
        problem = undefined;
        // Back to the start, so the replay can be stepped through from its first action.
        player.travel(-played.played);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      update();
      head.focus();
    };

    const download = () => {
      const made = player.toReplay();
      if (!made) return;
      const view = doc.defaultView;
      if (!view) return;
      const url = view.URL.createObjectURL(
        new view.Blob([writeReplay(made)], { type: "application/json" }),
      );
      const link = el("a");
      link.href = url;
      link.download = `${made.game?.id ?? "game"}-replay.json`;
      link.click();
      view.URL.revokeObjectURL(url);
    };

    /** What the panel says about the opened replay, and the controls to step through it. */
    const status = (o: Opened): HTMLElement[] => {
      const out: HTMLElement[] = [];
      const total = o.replay.actions.length;
      const steps = player.history;
      const here = steps?.past.length ?? 0;
      // A move of the player's own drops the moves ahead, or, if it's the one
      // the replay made, makes the same game: either way the log says which.
      const taken = JSON.stringify(player.story?.actions ?? []);
      const inReplay =
        steps !== undefined &&
        here + steps.future.length === o.played.played &&
        taken === JSON.stringify(o.replay.actions.slice(0, here));
      const notes: string[] = [];
      if (o.played.check.sameGameVersion === false) {
        notes.push(
          `It was made with version ${o.replay.game?.version ?? "?"} of the game; this is ${player.toReplay()?.game?.version ?? "another"}.`,
        );
      }
      if (o.played.check.sameEngineVersion === false) {
        notes.push(`It was made with engine ${o.replay.engine ?? "?"}; this is ${ENGINE_VERSION}.`);
      }
      for (const note of notes) out.push(el("p", "replay-note", note));
      if (o.played.failed) {
        const f = o.played.failed;
        const why = el("p", "part-error");
        why.append(
          `Action ${String(f.index + 1)} of ${String(total)} couldn't be taken, so the replay stops before it: `,
          el("code", undefined, f.message),
        );
        out.push(why);
      }
      if (!inReplay) {
        out.push(
          el(
            "p",
            "replay-note",
            "You've left the replay by making a new move. Open it again to go back.",
          ),
        );
        return out;
      }
      const nav = el("div", "replay-nav");
      const back = button("Back", () => {
        player.travel(-1);
      });
      const next = button("Next", () => {
        player.travel(1);
      });
      back.disabled = here === 0;
      next.disabled = here === o.played.played;
      const upcoming = steps.future[0]?.label;
      nav.append(back, next);
      out.push(nav);
      out.push(
        el(
          "p",
          "replay-next",
          upcoming === undefined ? "That's the end of the replay." : `Next: ${upcoming}`,
        ),
      );
      return out;
    };

    const update = () => {
      if (opened && opened.story !== player.story) opened = undefined;
      head.className = problem === undefined ? "replay-status" : "replay-status part-error";
      if (problem !== undefined) {
        head.textContent = `That file couldn't be opened: ${problem}`;
      } else if (opened) {
        const here = player.history?.past.length ?? 0;
        head.textContent = `${opened.name}: action ${String(here)} of ${String(opened.played.played)}${
          opened.played.played === opened.replay.actions.length
            ? ""
            : ` (the file has ${String(opened.replay.actions.length)})`
        }.`;
      } else {
        head.textContent =
          "Open a replay file, such as one from a bug report, to play it here a move at a time.";
      }
      const actions = el("div", "replay-actions");
      actions.append(
        button("Open replay…", () => {
          file.click();
        }),
        button("Download replay", download),
      );
      (actions.lastElementChild as HTMLButtonElement).disabled =
        player.story?.current === undefined;
      rest.replaceChildren(...(opened ? status(opened) : []), actions);
    };

    element.replaceChildren(head, rest, file);
    update();
    return { update };
  },
};
