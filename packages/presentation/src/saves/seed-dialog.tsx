/**
 * The Seed dialog (#132, ADR 0108): the game's seed, to copy or share as a
 * link, and a field to play another. Opened from the game menu's Seed, or
 * from the start screen's "New game with a seed…".
 */
import { message } from "@loominate-if/core";
import { render } from "preact";
import "../messages.js";
import { _parseSeed, _sharedSeed } from "./seed.js";

/** The Seed dialog. */
export type SeedDialog = {
  /** The dialog element. */
  readonly element: HTMLDialogElement;
  /** Opens it, focused on the seed to copy, or on the field to play one. */
  open(focus?: "copy" | "enter"): void;
  /** Closes it. */
  close(): void;
};

let dialogs = 0;

/** Makes the Seed dialog in `parent`. */
export function createSeedDialog(
  parent: HTMLElement,
  options: {
    /** The game's version, which a shared seed carries. */
    readonly version: string;
    /** The seed of the game in play, if one's begun. */
    readonly current: () => string | undefined;
    /** Whether it's today's seed, which everyone shares, rather than one to choose. */
    readonly daily: boolean;
    /** Whether the player can play a seed of their own choosing. */
    readonly entry: boolean;
    /** A link to play a shared seed, where the page has one. */
    readonly link: (shared: string) => string | undefined;
    /** Starts a new game from a seed. */
    readonly play: (seed: string) => void;
  },
): SeedDialog {
  const doc = parent.ownerDocument;
  const id = `loominate-seed-${String(++dialogs)}`;
  const dialog = doc.createElement("dialog");
  dialog.className = "loominate-seed";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  parent.append(dialog);
  let typed = "";
  let status = "";

  const close = (): void => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.open = false;
  };

  const copy = (text: string, done: string): void => {
    const clip = doc.defaultView?.navigator.clipboard;
    (clip ? clip.writeText(text) : Promise.reject(new Error("no clipboard")))
      .then(() => {
        status = done;
        draw();
      })
      .catch(() => {
        status = message("seed.copyFailed");
        draw();
      });
  };

  const play = (): void => {
    const parsed = _parseSeed(typed);
    if (!parsed) return;
    close();
    options.play(parsed.seed);
  };

  const draw = (): void => {
    const seed = options.current();
    const shared = seed === undefined ? undefined : _sharedSeed(seed, options.version);
    const link = shared === undefined || !options.entry ? undefined : options.link(shared);
    const parsed = _parseSeed(typed);
    const other =
      parsed?.version !== undefined && parsed.version !== options.version
        ? parsed.version
        : undefined;
    render(
      <>
        <h2 id={`${id}-title`}>{message("seed.title")}</h2>
        {shared === undefined ? (
          <p>{message("seed.none")}</p>
        ) : (
          <p>
            {`${message(options.daily ? "seed.daily" : "seed.current")} `}
            {/* A seed is its words, as they are: not to be translated. */}
            <strong className="loominate-seed-words" translate={false}>
              {shared}
            </strong>
          </p>
        )}
        {shared !== undefined && (
          <p className="loominate-seed-actions">
            <button
              type="button"
              className="loominate-seed-copy"
              onClick={() => {
                copy(shared, message("seed.copied"));
              }}
            >
              {message("seed.copy")}
            </button>
            {link !== undefined && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => {
                    copy(link, message("seed.linkCopied"));
                  }}
                >
                  {message("seed.copyLink")}
                </button>
              </>
            )}
          </p>
        )}
        <p className="loominate-seed-status" role="status">
          {status}
        </p>
        {options.entry && (
          <form
            className="loominate-seed-play"
            onSubmit={(event) => {
              event.preventDefault();
              play();
            }}
          >
            <label htmlFor={`${id}-enter`}>{message("seed.enter")}</label>{" "}
            <input
              id={`${id}-enter`}
              type="text"
              className="loominate-seed-input"
              autoComplete="off"
              autoCapitalize="none"
              spellcheck={false}
              translate={false}
              value={typed}
              aria-describedby={`${id}-note${other === undefined ? "" : ` ${id}-other`}`}
              onInput={(event) => {
                typed = (event.currentTarget as HTMLInputElement).value;
                draw();
              }}
            />{" "}
            <button type="submit">{message("seed.play")}</button>
            <p id={`${id}-note`} className="loominate-note">
              {message("seed.playNote")}
            </p>
            {other !== undefined && (
              <p id={`${id}-other`} className="loominate-note">
                {message("seed.otherVersion", { version: other, current: options.version })}
              </p>
            )}
          </form>
        )}
        <button type="button" onClick={close}>
          {message("seed.close")}
        </button>
      </>,
      dialog,
    );
  };

  return {
    element: dialog,
    open(focus = "copy") {
      typed = "";
      status = "";
      draw();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
      const target =
        focus === "enter" || options.current() === undefined
          ? dialog.querySelector<HTMLElement>(".loominate-seed-input")
          : dialog.querySelector<HTMLElement>(".loominate-seed-copy");
      (target ?? dialog.querySelector<HTMLElement>("button"))?.focus();
    },
    close,
  };
}
