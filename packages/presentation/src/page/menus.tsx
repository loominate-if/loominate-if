/**
 * Things' menus (#77, ADR 0046): what the player can do with a thing,
 * opened from its name in the text or from the inventory.
 *
 * It's the menu button pattern: the name is a button that opens a menu of
 * the thing's actions, which arrow keys move through, Enter or a click
 * takes, and Escape, Tab, or a click elsewhere closes, giving focus back.
 * Actions verify hides aren't listed; those check disables are, with why.
 */
import {
  actionsFor,
  message,
  statusOf,
  type ActionCall,
  type ActionStatus,
  type AskedNumber,
} from "@loominate-if/core";
import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import "../messages.js";
import { now } from "./view.js";

/** What the menus need from the page. */
export type MenuHost = {
  readonly doc: Document;
  /** Takes the chosen action, and redraws the page. */
  readonly act: (call: ActionCall, label: string) => void;
};

/** One choice in a menu that isn't a thing's: an action, and what to call it, if not its own label. */
export type MenuChoice = {
  // A call of any action: an action's type is invariant in its arguments, so no narrower type takes them all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly call: ActionCall<any>;
  readonly label?: string;
};

/**
 * What a menu lists: the actions for the thing with this ID, or, from a
 * function, the choices it gives when the menu opens.
 */
export type MenuSource = string | (() => readonly MenuChoice[]);

/** Opens and closes things' menus. */
export type Menus = {
  /** Opens the menu for `source`, under `anchor`, which it gives focus back to. */
  open(source: MenuSource, anchor: HTMLElement): void;
  /** Closes the menu on show, if any. */
  close(): void;
  /** Makes `anchor` a button that opens the menu for `source`. */
  trigger(anchor: HTMLElement, source: MenuSource): void;
};

let menus = 0;

/** What a menu is told by the page it's on. */
type Props = {
  readonly id: string;
  readonly source: MenuSource;
  readonly anchor: HTMLElement;
  readonly host: MenuHost;
  /** Closes the menu, giving focus back to its name if asked. */
  readonly close: (focusAnchor?: boolean) => void;
};

/** A choice as the menu lists it: its call, what it says, and how it stands now. */
type Listed = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly call: ActionCall<any>;
  readonly label: string;
  readonly status: ActionStatus;
};

/**
 * A menu of a thing's actions, or of the choices a function gives, which an
 * action that asks for numbers swaps for a form asking for them.
 */
function Menu({ id, source, anchor, host, close }: Props) {
  // What it's asking for, and which choice asked, so going back lands on it.
  const [asking, setAsking] = useState<
    { readonly listed: Listed; readonly at: number } | undefined
  >(undefined);
  const holder = useRef<HTMLSpanElement>(null);
  const focusAt = useRef(0);
  useLayoutEffect(() => {
    const root = holder.current;
    if (!root) return;
    if (asking) {
      const input = root.querySelector<HTMLInputElement>("input");
      input?.select();
      input?.focus();
    } else {
      root.querySelectorAll<HTMLElement>("[role=menuitem]")[focusAt.current]?.focus();
    }
  }, [asking]);
  const back = (): void => {
    focusAt.current = asking?.at ?? 0;
    now(() => {
      setAsking(undefined);
    });
  };
  return (
    <span ref={holder} className="loominate-menu-holder">
      {asking ? (
        <Ask
          id={`${id}-ask`}
          listed={asking.listed}
          host={host}
          anchor={anchor}
          close={close}
          back={back}
        />
      ) : (
        <List
          id={id}
          source={source}
          anchor={anchor}
          host={host}
          close={close}
          ask={(listed, at) => {
            now(() => {
              setAsking({ listed, at });
            });
          }}
        />
      )}
    </span>
  );
}

function List({
  id,
  source,
  anchor,
  host,
  close,
  ask,
}: Props & { readonly ask: (listed: Listed, at: number) => void }) {
  const choices: readonly MenuChoice[] =
    typeof source === "string" ? actionsFor({ id: source }).map((call) => ({ call })) : source();
  const listed: Listed[] = choices.flatMap(({ call, label }) => {
    const status = statusOf(call);
    return status.hidden === undefined ? [{ call, label: label ?? status.label, status }] : [];
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    const items = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role=menuitem]"),
    ];
    const at = items.indexOf(anchor.ownerDocument.activeElement as HTMLElement);
    const to = (i: number) => {
      items[(i + items.length) % items.length]?.focus();
      event.preventDefault();
    };
    if (event.key === "ArrowDown") to(at + 1);
    else if (event.key === "ArrowUp") to(at - 1);
    else if (event.key === "Home") to(0);
    else if (event.key === "End") to(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close();
  };
  return (
    <ul
      className="loominate-menu"
      id={id}
      role="menu"
      aria-labelledby={anchor.id}
      onKeyDown={onKeyDown}
    >
      {listed.length === 0 ? (
        <li role="none">
          <span role="menuitem" aria-disabled="true" tabIndex={-1} className="loominate-menu-item">
            {message("menu.nothing")}
          </span>
        </li>
      ) : (
        listed.map((l, i) => {
          const disabled = l.status.disabled;
          const why = `${id}-why-${String(i)}`;
          return (
            <li key={i} role="none">
              <button
                type="button"
                className="loominate-menu-item"
                role="menuitem"
                tabIndex={-1}
                {...(disabled !== undefined
                  ? { "aria-disabled": "true", "aria-describedby": why }
                  : {
                      onClick: () => {
                        if (l.status.asks !== undefined) ask(l, i);
                        else {
                          close();
                          host.act(l.call, l.label);
                        }
                      },
                    })}
              >
                {l.label}
              </button>
              {disabled !== undefined && (
                <span className="loominate-menu-reason" id={why}>
                  {disabled}
                </span>
              )}
            </li>
          );
        })
      )}
    </ul>
  );
}

/** A form asking for an action's numbers: a labelled number field for each, and buttons to take it or go back. */
function Ask({
  id,
  listed,
  host,
  close,
  back,
}: {
  readonly id: string;
  readonly listed: Listed;
  readonly host: MenuHost;
  readonly anchor: HTMLElement;
  readonly close: () => void;
  readonly back: () => void;
}) {
  const asks = listed.status.asks ?? [];
  const [problem, setProblem] = useState<
    { readonly at: number; readonly text: string } | undefined
  >(undefined);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    if (problem) form.current?.querySelectorAll("input")[problem.at]?.focus();
  }, [problem]);
  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const inputs = [...(form.current?.querySelectorAll("input") ?? [])];
    const args: Record<string, number> = {};
    for (const [i, asked] of asks.entries()) {
      const value = inputs[i]?.value ?? "";
      const n = Number(value);
      if (
        value.trim() === "" ||
        !Number.isInteger(n) ||
        n < asked.min ||
        (asked.max !== undefined && n > asked.max)
      ) {
        now(() => {
          setProblem({
            at: i,
            text: message("menu.ask.problem", {
              min: asked.min,
              ...(asked.max !== undefined && { max: asked.max }),
            }),
          });
        });
        return;
      }
      args[asked.name] = n;
    }
    close();
    host.act({ ...listed.call, args: { ...(listed.call.args as object), ...args } }, listed.label);
  };
  return (
    <form
      ref={form}
      className="loominate-menu loominate-menu-ask"
      id={id}
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        back();
      }}
    >
      <p className="loominate-menu-ask-title" id={`${id}-title`}>
        {listed.label.replace(/…$/, "")}
      </p>
      {asks.map((asked: AskedNumber, i) => {
        const field = `${id}-${asked.name}`;
        return (
          <p key={asked.name} className="loominate-menu-ask-field">
            <label htmlFor={field}>{asked.label}</label>{" "}
            <input
              type="number"
              inputMode="numeric"
              id={field}
              min={String(asked.min)}
              {...(asked.max !== undefined && {
                max: String(asked.max),
                "aria-describedby": `${field}-of`,
              })}
              step="1"
              defaultValue={String(asked.start)}
              {...(problem?.at === i && { "aria-invalid": "true" })}
            />
            {asked.max !== undefined && (
              <>
                {" "}
                <span id={`${field}-of`}>{message("menu.ask.of", { max: asked.max })}</span>
              </>
            )}
          </p>
        );
      })}
      <p className="loominate-menu-reason" role="alert">
        {problem?.text}
      </p>
      <p className="loominate-menu-ask-buttons">
        <button type="submit" className="loominate-link">
          {listed.status.confirm ?? message("menu.ask.confirm", {})}
        </button>{" "}
        <button type="button" className="loominate-link" onClick={back}>
          {message("menu.ask.back", {})}
        </button>
      </p>
    </form>
  );
}

/** Creates the menus for a page. */
export function createMenus(host: MenuHost): Menus {
  const { doc } = host;
  let shown: { readonly holder: HTMLElement; readonly anchor: HTMLElement } | undefined;

  const close = (focusAnchor = false): void => {
    if (!shown) return;
    const { holder, anchor } = shown;
    shown = undefined;
    render(null, holder);
    holder.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor.focus();
  };

  const open = (source: MenuSource, anchor: HTMLElement): void => {
    close();
    const id = `loominate-menu-${String(++menus)}`;
    if (!anchor.id) anchor.id = `${id}-button`;
    const holder = doc.createElement("span");
    anchor.insertAdjacentElement("afterend", holder);
    anchor.setAttribute("aria-expanded", "true");
    shown = { holder, anchor };
    now(() => {
      render(<Menu id={id} source={source} anchor={anchor} host={host} close={close} />, holder);
    });
  };

  // A click anywhere but the menu and its button closes it.
  doc.addEventListener("click", (event) => {
    if (!shown) return;
    const target = event.target as Node | null;
    if (target && (shown.holder.contains(target) || shown.anchor.contains(target))) return;
    // A click on something it just took away, such as the menu choice that gave way to a form.
    if (target && !target.isConnected) return;
    close();
  });

  const trigger = (anchor: HTMLElement, source: MenuSource): void => {
    anchor.classList.add("loominate-menu-link");
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "false");
    anchor.addEventListener("click", () => {
      if (shown?.anchor === anchor) close();
      else open(source, anchor);
    });
    // The arrow keys open it too, as a menu button's do.
    anchor.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      open(source, anchor);
    });
  };

  return { open, close: () => close(), trigger };
}
