/**
 * The Sound dialog (#146): sound on or off, each channel's volume, and
 * captions, from the game menu at any time. What's chosen applies at once
 * and is kept for this game in the browser, as the default for later games.
 */
import { message } from "@loominate-if/core";
import { render } from "preact";
import "../messages.js";
import type { SoundSettings } from "./player.js";

/** The Sound dialog. @internal */
export type SoundDialog = {
  readonly element: HTMLDialogElement;
  open(): void;
  close(): void;
};

let dialogs = 0;

/** Makes the Sound dialog in `parent`. @internal */
export function createSoundDialog(
  parent: HTMLElement,
  options: {
    readonly settings: () => SoundSettings;
    readonly change: (next: SoundSettings) => void;
  },
): SoundDialog {
  const doc = parent.ownerDocument;
  const id = `loominate-sound-${String(++dialogs)}`;
  const dialog = doc.createElement("dialog");
  dialog.className = "loominate-sound";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  parent.append(dialog);

  const close = (): void => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.open = false;
  };
  const set = (next: Partial<SoundSettings>): void => {
    options.change({ ...options.settings(), ...next });
    draw();
  };

  const slider = (key: "music" | "ambience" | "effects") => {
    const s = options.settings();
    return (
      <p className="loominate-sound-volume">
        <label htmlFor={`${id}-${key}`}>{message(`sound.${key}`, {})}</label>{" "}
        <input
          id={`${id}-${key}`}
          type="range"
          min="0"
          max="100"
          step="5"
          value={String(Math.round(s[key] * 100))}
          disabled={!s.on}
          aria-valuetext={`${String(Math.round(s[key] * 100))}%`}
          onInput={(event) => {
            set({ [key]: Number((event.currentTarget as HTMLInputElement).value) / 100 });
          }}
        />
      </p>
    );
  };

  const draw = (): void => {
    const s = options.settings();
    render(
      <>
        <h2 id={`${id}-title`}>{message("sound.title", {})}</h2>
        <p>
          <button
            type="button"
            className="loominate-sound-toggle"
            aria-pressed={s.on ? "true" : "false"}
            onClick={() => {
              set({ on: !s.on });
            }}
          >
            {message("sound.on", {})}
            <span className="loominate-switch-state" aria-hidden="true">
              {` ${message(s.on ? "sound.isOn" : "sound.isOff", {})}`}
            </span>
          </button>
        </p>
        {slider("music")}
        {slider("ambience")}
        {slider("effects")}
        <p>
          <input
            id={`${id}-captions`}
            type="checkbox"
            checked={s.captions}
            onChange={(event) => {
              set({ captions: (event.currentTarget as HTMLInputElement).checked });
            }}
          />{" "}
          <label htmlFor={`${id}-captions`}>{message("sound.captions", {})}</label>
        </p>
        <button type="button" onClick={close}>
          {message("sound.close", {})}
        </button>
      </>,
      dialog,
    );
  };

  return {
    element: dialog,
    open() {
      draw();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
      dialog.querySelector<HTMLElement>(".loominate-sound-toggle")?.focus();
    },
    close,
  };
}
