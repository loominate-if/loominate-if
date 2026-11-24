/**
 * The page model (#37): each move replaces the main view with the
 * new passage, and a "story so far" drawer shows what came before. The
 * drawer is drawn from the event record alone, so it shows exactly what the
 * player read, and undo, loading a save, or a replay change it just by
 * changing the record.
 *
 * It's drawn with Preact (ADR 0079), synchronously after each move, so
 * focus, effects, and beat timers can follow at once. A passage is a list of
 * parts, each keyed, so a beat's new part is added without touching what's
 * on screen, and the live region announces only it.
 */
import type {
  ActionCall,
  BeatNode,
  Choice,
  EventKind,
  NamedEffectNode,
  EventRecord,
  ProseFields,
  RecordedEvent,
  RenderedInlineLink,
  RenderedLink,
  RenderedNode,
  Story,
  TextStyle,
} from "@loominate-if/core";
import {
  display,
  layouts,
  widgets,
  type LayoutDefinition,
  type MountedWidget,
  type WidgetDefinition,
  type WidgetHost,
} from "./layout.js";
import { _isAtmosphere, _leadingNotices, _noticeParagraphs, message } from "@loominate-if/core";
import { render, type ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import "../messages.js";
import { prose } from "./prose.js";
import { createMenus, type MenuSource } from "./menus.js";
import { effects, type EffectDefinition, type EffectFinish } from "./effects.js";
import { addStyles } from "./theme.js";

/** What a page shows: a story and its event record. */
export type PageGame = {
  /** The story. The page begins it if it hasn't begun. */
  readonly story: Story;
  /** The story's event record, which the drawer is drawn from. */
  readonly record: EventRecord;
};

/** A move taken from a thing's menu, as `onMove` hears of it. */
export type ActionMove = {
  /** Always `action`. */
  readonly type: "action";
  /** The action's label, as the menu showed it. */
  readonly label: string;
};

/** Options for {@link mountPage}. */
export type PageOptions = {
  /**
   * Called after each move the player makes on the page, with the choice
   * followed or the beat moved past: a place to checkpoint undo history or
   * autosave, so undo and saves stop at beat boundaries too.
   */
  readonly onMove?: (move: Choice | BeatNode | ActionMove) => void;
  /**
   * Called with an error the story's code threw during play, such as an
   * `{on enter: …}` effect, after the page has shown it to the player. A
   * move whose effect throws is rolled back, so the game stays where it was.
   */
  readonly onError?: (error: unknown) => void;
  /**
   * How timed beats (`{beat 1.5s}`) play. `paced`, the default, waits out
   * each one; `immediate` moves past them at once, so the text appears
   * without pauses, as it also does when the player prefers reduced motion.
   * Offer `immediate` as a setting, for example for screen-reader players.
   * `{wait}` and `{page}` always wait for the player.
   */
  readonly pacing?: "paced" | "immediate";
  /** The label for the button that moves past every remaining beat. Defaults to "Skip". */
  readonly skipLabel?: string;
  /** The drawer's label. Defaults to "Story so far". */
  readonly drawerLabel?: string;
  /** The label for a continue point that has none. Defaults to "Continue". */
  readonly continueLabel?: string;
  /**
   * How a disabled link's reason is shown. `tooltip`, the default, shows it
   * beside the link when it's hovered, focused, or tapped, and Escape hides
   * it. `inline` shows it after the link, always. Either way, screen readers
   * hear it as the link's description.
   */
  readonly reasons?: "tooltip" | "inline";
  /**
   * Whether to add the default styles to the document. They sit in the
   * `loominate` cascade layer, so a game's own CSS overrides them without
   * this. Pass `false` to style the page from nothing. Defaults to `true`.
   */
  readonly styles?: boolean;
  /**
   * The media query under which a layout's sidebars collapse into drawers.
   * Defaults to `(max-width: 48rem)`.
   */
  readonly narrow?: string;
};

/** A story shown on a page. */
export interface Page {
  /** The page's root element. */
  readonly element: HTMLElement;
  /**
   * Redraws the page from the story and its record, after something outside
   * the page changed them, such as undo or loading a save. The passage's
   * named effects don't play again.
   */
  refresh(): void;
  /** Removes the page from the document. */
  destroy(): void;
}

/** Region names drawn as the HTML landmark element of the same name. */
const LANDMARKS: ReadonlySet<string> = new Set(["header", "footer", "nav", "aside"]);

/** A region's accessible name: `side-panel` is "Side panel". */
function regionLabel(region: string): string {
  const words = region.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Event kinds the drawer shows: prose the player read. */
const PROSE_KINDS: readonly EventKind[] = ["narrative", "scene", "dialogue", "room-description"];
/**
 * Events recorded during a move that the page shows after the passage's text, before its choices: what
 * the player noticed, what their actions did, and what fuses and daemons said.
 */
const NOTICE_KINDS: readonly EventKind[] = ["perception", "action-result", "scheduled"];

/** Recorded prose, with its styles. */
type Proseful = RecordedEvent & { readonly text: string; readonly styles?: readonly TextStyle[] };

/** One paragraph of a passage on screen. */
type Item =
  | { readonly kind: "notices"; readonly key: string; readonly events: readonly Proseful[] }
  | {
      readonly kind: "text";
      readonly key: string;
      readonly node: Extract<RenderedNode, { type: "text" }>;
    }
  | {
      readonly kind: "choice";
      readonly key: string;
      readonly node: RenderedLink | Extract<RenderedNode, { type: "continue" }>;
    };

/** Unique IDs for reasons, made once for each link drawn. */
let reasons = 0;

/** Whether two pieces of plain data are the same. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * A widget in its slot, mounted through its view, so a view written in any
 * framework works: updated when its data changes, and unmounted when it
 * leaves the page.
 */
function WidgetSlot(props: {
  readonly name: string;
  readonly definition: WidgetDefinition;
  readonly data: unknown;
  readonly host: WidgetHost;
}) {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<{ readonly mounted: MountedWidget<unknown>; data: unknown } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    if (!element.current) return undefined;
    view.current = {
      mounted: props.definition.view.mount(element.current, props.data, props.host),
      data: props.data,
    };
    return () => {
      view.current?.mounted.unmount();
      view.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    const v = view.current;
    if (v && !same(props.data, v.data)) {
      v.mounted.update(props.data);
      v.data = props.data;
    }
  });
  return (
    <div
      ref={element}
      className={`loominate-widget loominate-widget-${props.name}`}
      data-widget={props.name}
    />
  );
}

/** A thing's name, which opens its menu: registered with the menus once, when it's drawn. */
function MenuName(props: {
  readonly menus: { trigger(anchor: HTMLElement, source: MenuSource): void };
  readonly source: MenuSource;
  readonly className: string;
  readonly children: ComponentChildren;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (button.current) props.menus.trigger(button.current, props.source);
  }, []);
  return (
    <span className="loominate-has-menu">
      <button ref={button} type="button" className={props.className}>
        {props.children}
      </button>
    </span>
  );
}

/** Widget definitions' keys, so one replaced in its registry is mounted afresh. */
const definitionKeys = new WeakMap<object, number>();
let definitions = 0;
const definitionKey = (d: object): number => {
  let k = definitionKeys.get(d);
  if (k === undefined) definitionKeys.set(d, (k = ++definitions));
  return k;
};

/**
 * Shows a story in `container`: the current passage in the main view, and
 * the story so far in a drawer, in the layout named by `display.layout`, with
 * its widgets.
 *
 * @remarks
 * The passage is a live region in the page's `<main>` landmark, so screen
 * readers announce each new passage, and it takes focus after each move, so
 * the next Tab reaches its first choice. Links that can't be followed stay
 * focusable, marked `aria-disabled`, with their reasons as descriptions.
 * Every region is a landmark.
 *
 * @example
 * ```ts
 * const page = mountPage(document.querySelector("#app")!, { story, record }, {
 *   onMove: () => history.checkpoint(),
 * });
 * ```
 */
export function mountPage(container: HTMLElement, game: PageGame, options: PageOptions = {}): Page {
  const { story, record } = game;
  const doc = container.ownerDocument;
  if (options.styles !== false) addStyles(doc);

  const root = doc.createElement("div");
  root.className = "loominate-page";
  container.append(root);
  /** The passage's element, once drawn, to focus after each move. */
  let passage: HTMLElement | null = null;
  const focusPassage = (): void => {
    passage?.focus({ preventScroll: true });
  };

  /** An error the story's code threw, shown at the top of the passage until the next move. */
  let error: string | undefined;
  /**
   * Shows an error the story's code threw, at the top of the passage, where
   * it's announced, and passes it on. The next move clears it.
   */
  const failed = (thrown: unknown): void => {
    error = message("page.error", {
      error: thrown instanceof Error ? thrown.message : String(thrown),
    });
    renderPage();
    console.error(thrown);
    options.onError?.(thrown);
  };
  /** Runs a step of play, showing what goes wrong instead of failing silently. */
  const guarded =
    <A extends unknown[]>(step: (...args: A) => void) =>
    (...args: A): void => {
      try {
        step(...args);
      } catch (thrown) {
        failed(thrown);
      }
    };

  const follow = guarded((choice: Choice): void => {
    story.follow(choice);
    options.onMove?.(choice);
    draw(true);
    focusPassage();
  });

  const act = guarded((call: ActionCall, label: string): void => {
    story.act(call);
    options.onMove?.({ type: "action", label });
    draw(true);
    focusPassage();
  });

  /** Things' menus, whose actions are moves like following a link. */
  const menus = createMenus({ doc, act });

  const tooltips = (options.reasons ?? "tooltip") === "tooltip";
  // Escape hides any reason on show; a tap elsewhere hides tapped ones.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Only the reasons on show, so one hovered later still appears.
    for (const h of root.querySelectorAll(".loominate-has-reason")) {
      if (!h.matches(":hover, :focus-within, [data-shown]")) continue;
      h.removeAttribute("data-shown");
      h.setAttribute("data-dismissed", "");
    }
  });
  doc.addEventListener("click", (event) => {
    const inside = (event.target as Element | null)?.closest(".loominate-has-reason");
    for (const h of root.querySelectorAll(".loominate-has-reason[data-shown]")) {
      if (h !== inside) h.removeAttribute("data-shown");
    }
  });

  /** Reason IDs, by the key of the paragraph and the link, so they stay put across redraws. */
  const reasonIds = new Map<string, string>();
  const reasonId = (key: string): string => {
    let id = reasonIds.get(key);
    if (id === undefined) reasonIds.set(key, (id = `loominate-reason-${String(++reasons)}`));
    return id;
  };

  /**
   * A button for a link or continue point. One that can't be followed is
   * marked `aria-disabled` rather than `disabled`, so it stays in the tab
   * order and a keyboard or screen-reader player still finds it and its reason.
   */
  const button = (
    node: RenderedLink | Extract<RenderedNode, { type: "continue" }>,
    label: ComponentChildren,
    className: string,
    describedBy?: string,
  ): ComponentChildren => {
    if (node.type === "link" && !node.available) {
      return (
        <button
          type="button"
          className={className}
          aria-disabled="true"
          {...(describedBy !== undefined && { "aria-describedby": describedBy })}
        >
          {label}
        </button>
      );
    }
    // A thing's name opens its menu, instead of being followed.
    if (node.type === "link" && node.guard?.menu !== undefined) {
      return (
        <MenuName menus={menus} source={node.guard.menu} className={className}>
          {label}
        </MenuName>
      );
    }
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          follow(node);
        }}
      >
        {label}
      </button>
    );
  };

  /** A reason a link is disabled, linked to its button for screen readers. */
  const reason = (id: string, text: string, tooltip: boolean): ComponentChildren => (
    <span
      className={tooltip ? "loominate-reason loominate-tooltip" : "loominate-reason"}
      id={id}
      {...(tooltip && { role: "tooltip" })}
    >
      {text}
    </span>
  );
  /**
   * A disabled link with its reason as a tooltip: shown while the link is
   * hovered or focused, or after it's tapped, and hidden by Escape. The
   * reason stays in the page, so screen readers hear it as the description.
   */
  const withTooltip = (
    b: ComponentChildren,
    r: ComponentChildren,
    key?: string | number,
  ): ComponentChildren => {
    // Escape hides it until the pointer or focus leaves and comes back.
    const reset = (event: Event): void => {
      (event.currentTarget as HTMLElement).removeAttribute("data-dismissed");
    };
    return (
      <span
        key={key}
        className="loominate-has-reason"
        onClick={(event) => {
          const holder = event.currentTarget as HTMLElement;
          if ((event.target as Element).closest(".loominate-reason")) return;
          if (holder.hasAttribute("data-shown")) holder.removeAttribute("data-shown");
          else holder.setAttribute("data-shown", "");
          holder.removeAttribute("data-dismissed");
        }}
        onPointerLeave={reset}
        onFocusOut={reset}
      >
        {b}
        {r}
      </span>
    );
  };

  // ---- Named effects ----------------------------------------------------

  /** How to finish the effects still playing. */
  let playing: EffectFinish[] = [];
  const finishEffects = (): void => {
    const now = playing;
    playing = [];
    for (const finish of now) finish();
  };
  // A click or key press anywhere on the page finishes them, so the player is never kept waiting.
  root.addEventListener("click", finishEffects, { capture: true });
  root.addEventListener("keydown", finishEffects, { capture: true });

  const effect = (node: NamedEffectNode): EffectDefinition => {
    const definition = effects.get(node.name);
    if (!definition) {
      throw new Error(
        `The effect "${node.name}" isn't registered. Register it with effects.register("${node.name}", { play(element) { … } }), or use one that is: ${effects
          .entries()
          .map((e) => e.key)
          .join(", ")}.`,
      );
    }
    return definition;
  };

  const reducedMotion = (): boolean =>
    doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  /** Plays effects on their elements, or their reduced variants if the player prefers less motion. */
  const playEffects = (queue: readonly [EffectDefinition, NamedEffectNode, HTMLElement][]) => {
    if (queue.length === 0) return;
    const reduce = reducedMotion();
    for (const [definition, node, element] of queue) {
      const play = reduce ? definition.reduced : definition.play;
      const finish = play?.(element, {
        options: node.options ?? {},
        page: root,
        ...(node.duration !== undefined && { duration: node.duration }),
      });
      if (finish) playing.push(finish);
    }
  };

  // ---- The passage, as parts ---------------------------------------------

  /** The paragraphs on screen: the passage's parts, as beats revealed them. */
  let items: Item[] = [];
  /** Which page of keys is on screen; a redraw from the top starts a new one. */
  let generation = 0;
  /** The elements drawn for each paragraph, by key, for effects to play on. */
  const elements = new Map<string, HTMLElement>();
  /** The pending beat, if any, and whether its controls show Continue. */
  let beatShown: { readonly continues: boolean } | undefined;

  // ---- Beats --------------------------------------------------------------

  /** The pending timed beat's timer, if one is running. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** How many rendered nodes are on screen, so a beat's new part is appended after them. */
  let drawnCount = 0;
  /** The controls for the pending beat, once drawn. */
  let beatControls: HTMLElement | null = null;

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const immediate = (): boolean => options.pacing === "immediate" || reducedMotion();

  /**
   * Moves focus to the first paragraph a beat revealed, so a screen reader
   * reads on from there: only what's new. Moving past a beat removes its
   * controls, and a screen reader's cursor on them would otherwise fall back
   * to the top of the window. A click doesn't always focus a button, as on
   * macOS, so a move the player makes moves focus whether or not it was on
   * the controls.
   */
  const focusNew = (key: string | undefined): void => {
    const element = key === undefined ? undefined : elements.get(key);
    if (!element) {
      focusPassage();
      return;
    }
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
  };

  /**
   * Moves past the pending beat, and shows the part it reveals. `byPlayer`
   * is true for the player's own move, and false for a timed beat passing.
   */
  const advance = guarded((byPlayer: boolean): void => {
    const beat = story.render().beat;
    if (!beat) return;
    const focused = byPlayer || (beatControls?.contains(doc.activeElement) ?? false);
    story.advance();
    options.onMove?.(beat);
    // A page break clears the screen; otherwise the new part follows what's shown.
    const first = draw(true, beat.page ? 0 : drawnCount);
    if (focused) focusNew(first);
  });

  /** Moves past every remaining beat at once, without their effects. */
  const skip = guarded((): void => {
    let from = drawnCount;
    for (let beat = story.render().beat; beat; beat = story.render().beat) {
      story.advance();
      options.onMove?.(beat);
      if (beat.page) from = 0;
    }
    focusNew(draw(false, from));
  });

  // A click on the page, away from its buttons, hurries a timed pause along.
  root.addEventListener("click", (event) => {
    if (timer === undefined) return;
    if ((event.target as Element | null)?.closest("button, a, summary, input, select, textarea"))
      return;
    stopTimer();
    advance(true);
  });

  /**
   * The perception and action-result events of the move on screen: since it
   * began, or with `sinceBeat`, since the last beat moved past.
   */
  const notices = (sinceBeat: boolean): Proseful[] => {
    const events = record.events({ kinds: [...NOTICE_KINDS, "navigation", "action", "beat"] });
    const out: Proseful[] = [];
    for (const e of events) {
      const starts =
        (e.kind === "navigation" && e.redirected !== true) ||
        e.kind === "action" ||
        (e.kind === "beat" && (sinceBeat || e.page === true));
      if (starts) out.length = 0;
      // A redirect within the move is kept, to tell what led to it from what came after.
      else if (NOTICE_KINDS.includes(e.kind) || e.kind === "navigation") {
        out.push(e as Proseful);
      }
    }
    return out;
  };

  /**
   * Works out the passage's paragraphs, keeping the first `from` nodes'
   * paragraphs on screen and adding the rest, and the effects to play on them.
   */
  const buildPassage = (
    from: number,
  ): { readonly queue: [EffectDefinition, NamedEffectNode, string][]; readonly first?: string } => {
    if (from === 0) {
      generation++;
      items = [];
      error = undefined;
    }
    const part = `${String(generation)}:${String(from)}`;
    const rendered = story.render();
    /** Effects waiting for the next paragraph drawn. */
    let pending: [EffectDefinition, NamedEffectNode][] = [];
    const queue: [EffectDefinition, NamedEffectNode, string][] = [];
    let n = 0;
    const add = (item: Item): void => {
      items.push(item);
      for (const [definition, node] of pending) queue.push([definition, node, item.key]);
      pending = [];
    };
    const key = (): string => `${part}:${String(n++)}`;
    // What the player noticed goes where `{notices}` puts it, or else after the
    // passage's own text and before its choices: the text says what the player
    // did, the notices what came of it.
    const nodes = rendered.nodes.slice(from);
    const placed = nodes.some((node) => node.type === "notices");
    // What led to a redirect comes first, before the passage the player was sent to.
    const { lead, rest } = _leadingNotices(notices(from > 0));
    let noticesLeft = rest;
    const addNotices = (events: readonly (RecordedEvent & ProseFields)[]): void => {
      // Atmosphere from fuses and daemons runs together; what stands out has its own paragraph.
      for (const paragraph of _noticeParagraphs(events)) {
        add({ kind: "notices", key: key(), events: paragraph as Proseful[] });
      }
    };
    if (from === 0) addNotices(lead);
    else noticesLeft = [...lead, ...rest];
    for (const node of nodes) {
      if (
        node.type === "notices" ||
        (!placed && (node.type === "link" || node.type === "continue"))
      ) {
        addNotices(noticesLeft);
        noticesLeft = [];
      }
      if (node.type === "notices") continue;
      if (node.type === "effect") {
        const definition = effect(node);
        if (definition.target === "page") queue.push([definition, node, ""]);
        else pending.push([definition, node]);
      } else if (node.type === "text") add({ kind: "text", key: key(), node });
      else add({ kind: "choice", key: key(), node });
    }
    addNotices(noticesLeft);
    drawnCount = rendered.nodes.length;
    const first = items.find((item) => item.key.startsWith(`${part}:`))?.key;
    return { queue, ...(first !== undefined && { first }) };
  };

  /** One paragraph of the passage. */
  const paragraph = (item: Item): ComponentChildren => {
    const ref = (element: HTMLElement | null): void => {
      if (element) elements.set(item.key, element);
    };
    if (item.kind === "notices") {
      return (
        <p key={item.key} ref={ref} className="loominate-notice">
          {item.events.map((notice, i) => [
            i > 0 ? " " : null,
            ...prose(notice.text, notice.styles ?? [], [], () => null),
          ])}
        </p>
      );
    }
    if (item.kind === "text") {
      const { node } = item;
      const after: { id: string; text: string }[] = [];
      const p = (
        <p key={item.key} ref={ref}>
          {prose(
            node.text,
            node.styles ?? [],
            node.links ?? [],
            (link: RenderedInlineLink, label, k) => {
              const id =
                link.reason === undefined ? undefined : reasonId(`${item.key}:${String(k)}`);
              const b = button(link, label, "loominate-link loominate-inline", id);
              if (id === undefined || link.reason === undefined) return <span key={k}>{b}</span>;
              if (tooltips) return withTooltip(b, reason(id, link.reason, true), k);
              after.push({ id, text: link.reason });
              return <span key={k}>{b}</span>;
            },
          )}
        </p>
      );
      // Reasons for disabled inline links follow the paragraph, so the sentence still reads.
      return [
        p,
        ...after.map((r) => (
          <p key={`${item.key}:${r.id}`} className="loominate-note">
            {reason(r.id, r.text, false)}
          </p>
        )),
      ];
    }
    const { node } = item;
    if (node.type === "continue") {
      return (
        <p key={item.key} ref={ref} className="loominate-choice">
          {button(
            node,
            node.label ?? options.continueLabel ?? message("page.continue"),
            "loominate-continue",
          )}
        </p>
      );
    }
    const id = node.reason === undefined ? undefined : reasonId(item.key);
    const b = button(node, node.label, "loominate-link", id);
    return (
      <p key={item.key} ref={ref} className="loominate-choice">
        {id !== undefined && node.reason !== undefined
          ? tooltips
            ? withTooltip(b, reason(id, node.reason, true))
            : [b, " ", reason(id, node.reason, false)]
          : b}
      </p>
    );
  };

  /** The controls for a pending beat: Continue, unless it's timed and paced, and Skip. */
  const beatView = (shown: { readonly continues: boolean }): ComponentChildren => (
    <p
      className="loominate-beat"
      ref={(element) => {
        beatControls = element;
      }}
    >
      {shown.continues && (
        <button
          type="button"
          className="loominate-continue"
          onClick={() => {
            advance(true);
          }}
        >
          {options.continueLabel ?? message("page.continue")}
        </button>
      )}{" "}
      <button type="button" className="loominate-skip" onClick={skip}>
        {options.skipLabel ?? message("page.skip")}
      </button>
    </p>
  );

  // ---- The drawer ----------------------------------------------------------

  const turnsSoFar = (): RecordedEvent[][] => {
    const events = record.events({
      kinds: [...NOTICE_KINDS, ...PROSE_KINDS, "navigation", "action", "beat"],
    });
    // Each move starts at a navigation or an action, and each page of a
    // passage at a page break; the last of them is the one on screen.
    // Within a turn, notices follow the text of their part, as on the page,
    // though their effects ran, and recorded them, before the text.
    const turns: RecordedEvent[][] = [];
    let noticed: RecordedEvent[] = [];
    const endPart = (): void => {
      turns.at(-1)?.push(...noticed);
      noticed = [];
    };
    for (const e of events) {
      const starts =
        (e.kind === "navigation" && e.redirected !== true) ||
        e.kind === "action" ||
        (e.kind === "beat" && e.page === true);
      if (e.kind === "beat" || starts) endPart();
      if (starts || turns.length === 0) turns.push([]);
      if (NOTICE_KINDS.includes(e.kind)) noticed.push(e);
      else if (e.kind === "navigation" && e.redirected === true) {
        // What led to a redirect goes between the passage left and the one arrived at.
        turns.at(-1)?.push(...noticed.filter((n) => !_isAtmosphere(n)));
        noticed = noticed.filter(_isAtmosphere);
      } else if (e.kind !== "navigation" && e.kind !== "action" && e.kind !== "beat") {
        turns.at(-1)?.push(e);
      }
    }
    endPart();
    turns.pop();
    return turns.filter((t) => t.length > 0);
  };

  const drawerView = (): ComponentChildren => {
    const turns = turnsSoFar();
    return (
      <details className="loominate-drawer" hidden={turns.length === 0}>
        <summary>{options.drawerLabel ?? message("page.storySoFar")}</summary>
        <div className="loominate-drawer-content">
          {turns.map((turn, t) => (
            <section key={t} className="loominate-turn">
              {_noticeParagraphs(turn).map((events, i) => (
                <p key={i}>
                  {events.map((e, j) => {
                    const fields = e as Proseful;
                    return [
                      j > 0 ? " " : null,
                      ...prose(fields.text, fields.styles ?? [], [], () => null),
                    ];
                  })}
                </p>
              ))}
            </section>
          ))}
        </div>
      </details>
    );
  };

  // ---- Layout and widgets ------------------------------------------------

  const host: WidgetHost = {
    story,
    record,
    follow,
    goTo: guarded((target: string, label: string): void => {
      story.goTo(target);
      options.onMove?.({ type: "link", label, target });
      draw(true);
      focusPassage();
    }),
    act,
    menu: (anchor, thing) => {
      menus.trigger(anchor, thing);
    },
  };

  /** Which sidebars the player opened, kept across moves and layout switches. */
  const open = new Set<string>();
  const narrowQuery = doc.defaultView?.matchMedia?.(options.narrow ?? "(max-width: 48rem)");
  const onNarrow = (): void => {
    renderPage();
  };
  narrowQuery?.addEventListener("change", onNarrow);

  /** The layout `display.layout` names, checked. */
  const currentLayout = (): { readonly name: string; readonly definition: LayoutDefinition } => {
    const name = display.layout;
    const definition = layouts.get(name);
    if (!definition) {
      throw new Error(
        `The layout "${name}" isn't registered. Register it with layouts.register("${name}", { regions: […] }), or set display.layout to one that is.`,
      );
    }
    if (!definition.regions.includes("main")) {
      throw new Error(
        `The layout "${name}" has no "main" region, where the passage goes. Add "main" to its regions.`,
      );
    }
    for (const region of Object.keys(definition.widgets ?? {})) {
      if (!definition.regions.includes(region)) {
        throw new Error(
          `The layout "${name}" puts widgets in "${region}", which isn't one of its regions.`,
        );
      }
    }
    for (const [region, side] of Object.entries(definition.sidebars ?? {})) {
      if (!definition.regions.includes(region) || region === "main") {
        throw new Error(
          region === "main"
            ? `The layout "${name}" makes "main" a sidebar. Only other regions can be sidebars.`
            : `The layout "${name}" makes "${region}" a sidebar, but it isn't one of its regions.`,
        );
      }
      if (side !== "start" && side !== "end") {
        throw new Error(
          `The layout "${name}" puts the sidebar "${region}" at ${JSON.stringify(side)}. Use "start" or "end".`,
        );
      }
    }
    return { name, definition };
  };

  /** The page, as it stands: its layout's regions, the passage, the drawer, and the widgets. */
  const view = (): ComponentChildren => {
    const { name, definition } = currentLayout();
    const sidebars = definition.sidebars ?? {};
    const narrow = narrowQuery?.matches ?? false;
    const slots = (region: string): ComponentChildren =>
      (definition.widgets?.[region] ?? []).map((w) => {
        const d = widgets.get(w);
        if (!d) {
          throw new Error(
            `The widget "${w}" isn't registered. Register it with widgets.register("${w}", …).`,
          );
        }
        return (
          <WidgetSlot
            key={`${name}:${w}:${String(definitionKey(d))}`}
            name={w}
            definition={d}
            data={d.data(game)}
            host={host}
          />
        );
      });
    const regionView = (region: string): ComponentChildren => {
      const empty = region !== "main" && (definition.widgets?.[region] ?? []).length === 0;
      const className = `loominate-region loominate-region-${region}`;
      const side = sidebars[region];
      const expanded = !narrow || open.has(region);
      const panelId = `loominate-sidebar-${name}-${region}`;
      const content =
        region === "main"
          ? [
              <main key="main" className="loominate-main">
                <div
                  className="loominate-passage"
                  tabIndex={-1}
                  aria-live="polite"
                  ref={(element) => {
                    passage = element;
                  }}
                >
                  {error !== undefined && (
                    <p className="loominate-error" role="alert">
                      {error}
                    </p>
                  )}
                  {items.map(paragraph)}
                  {beatShown && beatView(beatShown)}
                </div>
                {drawerView()}
              </main>,
              slots(region),
            ]
          : side
            ? // A sidebar's widgets go in a panel that a button shows and hides on narrow screens.
              [
                <button
                  key="toggle"
                  type="button"
                  className="loominate-sidebar-toggle"
                  aria-controls={panelId}
                  aria-expanded={expanded ? "true" : "false"}
                  hidden={!narrow}
                  onClick={() => {
                    if (open.has(region)) open.delete(region);
                    else open.add(region);
                    renderPage();
                  }}
                >
                  {regionLabel(region)}
                </button>,
                <div
                  key="panel"
                  className="loominate-sidebar-panel"
                  id={panelId}
                  hidden={!expanded}
                >
                  {slots(region)}
                </div>,
              ]
            : slots(region);
      const props = {
        key: `${name}:${region}`,
        className,
        "data-region": region,
        ...(side !== undefined && { "data-sidebar": side }),
        hidden: empty,
      };
      if (region === "main") return <div {...props}>{content}</div>;
      // Every widget sits in a landmark, so screen-reader players can jump to it.
      if (LANDMARKS.has(region)) {
        const Tag = region as "header";
        return <Tag {...props}>{content}</Tag>;
      }
      return (
        <section {...props} aria-label={regionLabel(region)}>
          {content}
        </section>
      );
    };
    // Main and its sidebars share a row of columns, in visual order, so
    // reading and tab order match what's on screen.
    const of = (s: "start" | "end") => definition.regions.filter((r) => sidebars[r] === s);
    const sides = (["start", "end"] as const).filter((s) =>
      of(s).some((r) => (definition.widgets?.[r] ?? []).length > 0),
    );
    root.dataset.layout = name;
    if (sides.length > 0) root.dataset.sidebars = sides.join(" ");
    else delete root.dataset.sidebars;
    root.toggleAttribute("data-narrow", narrow);
    return definition.regions.flatMap((region) =>
      region === "main"
        ? [
            <div key="columns" className="loominate-columns">
              {of("start").map(regionView)}
              {regionView("main")}
              {of("end").map(regionView)}
            </div>,
          ]
        : sidebars[region]
          ? []
          : [regionView(region)],
    );
  };

  /** Draws the page as it stands, at once. */
  const renderPage = (): void => {
    render(view(), root);
  };

  /**
   * Draws the page, playing the passage's effects if the player just
   * arrived. With `from`, keeps the first `from` nodes' paragraphs on screen
   * and adds the rest, so a beat's new part is announced without repeating
   * what came before.
   */
  const draw = (arrived = false, from = 0): string | undefined => {
    finishEffects();
    stopTimer();
    beatShown = undefined;
    const { queue, first } = buildPassage(from);
    const beat = story.render().beat;
    const timed = beat?.duration !== undefined;
    // A timed beat the player just reached passes at once when pacing is immediate.
    if (beat && timed && arrived && immediate()) {
      renderPage();
      play(queue);
      advance(false);
      return first;
    }
    if (beat) beatShown = { continues: !timed || immediate() };
    renderPage();
    if (arrived) play(queue);
    // Wall-clock time paces the presentation only; the story moves on through advance().
    if (beat && timed && !immediate()) {
      timer = setTimeout(() => {
        advance(false);
      }, beat.duration);
    }
    return first;
  };

  /** Plays the queued effects on the paragraphs they were written before, or on the page. */
  const play = (queue: readonly [EffectDefinition, NamedEffectNode, string][]): void => {
    playEffects(
      queue.flatMap(([definition, node, key]) => {
        const element = key === "" ? root : elements.get(key);
        return element
          ? [[definition, node, element] as [EffectDefinition, NamedEffectNode, HTMLElement]]
          : [];
      }),
    );
  };

  // Effects play for a story starting here, not for one loaded from a save.
  const fresh = story.current === undefined;
  story.begin();
  draw(fresh);
  return {
    element: root,
    refresh: () => {
      draw();
    },
    destroy() {
      finishEffects();
      stopTimer();
      narrowQuery?.removeEventListener("change", onNarrow);
      render(null, root);
      root.remove();
    },
  };
}
