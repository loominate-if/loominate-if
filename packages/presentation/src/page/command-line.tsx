/**
 * The command line (#131, ADR 0107): a text field that takes only what the
 * page offers, with suggestions as the player types. It's the combobox
 * pattern: the field lists what matches below it, Up and Down move through
 * the list, Enter takes the one picked or what's typed, and Escape closes
 * the list. Focus stays in the field; what a command does is read through
 * the page's live region.
 */
import { message } from "@loominate-if/core";
import { useRef, useState } from "preact/hooks";
import "../messages.js";
import { matchCommands, type Command } from "./command.js";
import { now } from "./view.js";

/** How many suggestions show at once. */
const SHOWN = 8;
/** How many of what's possible a "You could" lists. */
const COULD = 6;

let lines = 0;

/** The command line, given what can be done now and how to do it. */
export function CommandLine(props: {
  /** What can be done now. */
  readonly commands: () => readonly Command[];
  /** Does a command, as a move. */
  readonly run: (command: Command) => void;
}) {
  const id = useRef(`loominate-command-${String(++lines)}`).current;
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(-1);
  const [listOpen, setListOpen] = useState(false);
  const [said, setSaid] = useState("");
  const history = useRef<string[]>([]);
  const back = useRef(-1);

  const matches = typed.trim() === "" ? [] : matchCommands(typed, props.commands()).matches;
  const shown = matches.slice(0, SHOWN);
  const expanded = listOpen && shown.length > 0;

  const take = (command: Command): void => {
    setListOpen(false);
    setActive(-1);
    if (command.disabled !== undefined) {
      setSaid(message("command.cannot", { what: command.label, why: command.disabled }));
      return;
    }
    history.current.push(command.label);
    back.current = -1;
    setTyped("");
    setSaid("");
    props.run(command);
    input.current?.focus();
  };

  const submit = (): void => {
    const picked = expanded && active >= 0 ? shown[active] : undefined;
    if (picked) {
      take(picked);
      return;
    }
    if (typed.trim() === "") return;
    const all = props.commands();
    const { matches: found, sure } = matchCommands(typed, all);
    if (sure) take(sure);
    else if (found.length > 0) {
      // Several it could mean: listed to pick from, never guessed.
      setSaid(message("command.which", { options: found.slice(0, SHOWN).map((c) => c.label) }));
      setListOpen(true);
      setActive(0);
    } else {
      // Nothing it could mean: what's possible instead, never "I don't understand".
      const could = all.filter((c) => c.disabled === undefined).map((c) => c.label);
      setSaid(
        message("command.none", { options: could.slice(0, COULD), more: could.length > COULD }),
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setListOpen(false);
        setActive(-1);
      } else if (typed !== "") {
        event.preventDefault();
        setTyped("");
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (expanded) {
        setActive((at) => (at + step + shown.length) % shown.length);
        return;
      }
      if (typed.trim() !== "" && back.current < 0 && shown.length > 0) {
        setListOpen(true);
        setActive(step > 0 ? 0 : shown.length - 1);
        return;
      }
      // With the list closed, earlier commands, newest first.
      const earlier = history.current;
      if (earlier.length === 0) return;
      const at =
        back.current < 0
          ? step < 0
            ? earlier.length - 1
            : -1
          : Math.max(-1, Math.min(earlier.length - 1, back.current - step));
      back.current = at;
      setTyped(at < 0 ? "" : (earlier[at] ?? ""));
    } else if (event.key === "Tab" && expanded && active >= 0) {
      // Tab completes the one picked, for the player to finish or take.
      const picked = shown[active];
      if (picked) {
        event.preventDefault();
        setTyped(picked.label);
        setListOpen(false);
        setActive(-1);
      }
    }
  };

  const option = (i: number) => `${id}-option-${String(i)}`;
  return (
    <div className="loominate-command">
      <label htmlFor={id} className="loominate-command-label">
        {message("command.label")}
      </label>
      <input
        ref={input}
        id={id}
        type="text"
        className="loominate-command-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded ? "true" : "false"}
        aria-controls={`${id}-list`}
        aria-describedby={`${id}-help`}
        {...(expanded && active >= 0 && { "aria-activedescendant": option(active) })}
        autoComplete="off"
        autoCapitalize="none"
        spellcheck={false}
        value={typed}
        onInput={(event) => {
          const value = (event.currentTarget as HTMLInputElement).value;
          // Drawn at once, so the suggestions keep up with the typing.
          now(() => {
            setTyped(value);
            setListOpen(true);
            setActive(-1);
            setSaid("");
          });
          back.current = -1;
        }}
        onKeyDown={(event) => {
          now(() => {
            onKeyDown(event);
          });
        }}
      />
      <span id={`${id}-help`} className="loominate-sr-only">
        {message("command.help")}
      </span>
      <ul
        id={`${id}-list`}
        className="loominate-command-list"
        role="listbox"
        aria-label={message("command.suggestions")}
        hidden={!expanded}
      >
        {shown.map((c, i) => (
          <li
            key={`${c.label}:${String(i)}`}
            id={option(i)}
            role="option"
            className="loominate-command-option"
            aria-selected={i === active ? "true" : "false"}
            {...(c.disabled !== undefined && { "aria-disabled": "true" })}
            onMouseDown={(event) => {
              // Keeps focus in the field.
              event.preventDefault();
            }}
            onClick={() => {
              now(() => {
                take(c);
              });
            }}
          >
            {c.label}
            {c.disabled !== undefined && (
              <span className="loominate-command-why">{` (${c.disabled})`}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="loominate-command-said" role="status">
        {said}
      </p>
    </div>
  );
}
