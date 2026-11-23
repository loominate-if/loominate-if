/**
 * The page model (#37): each move replaces the main view with the
 * new passage, and a "story so far" drawer shows what came before. The
 * drawer is drawn from the event record alone, so it shows exactly what the
 * player read, and undo, loading a save, or a replay change it just by
 * changing the record.
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
import { _noticeParagraphs, message } from "@loominate-if/core";
import "../messages.js";
import { appendProse } from "./prose.js";
import { createMenus } from "./menus.js";
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
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    return node;
  };

  const root = el("div", "loominate-page");
  // The passage and the drawer share the main landmark; only the passage is
  // live, so opening the drawer or redrawing it isn't announced.
  const main = el("main", "loominate-main");
  const passage = el("div", "loominate-passage");
  passage.tabIndex = -1;
  passage.setAttribute("aria-live", "polite");
  const drawer = el("details", "loominate-drawer");
  const summary = el("summary");
  summary.textContent = options.drawerLabel ?? message("page.storySoFar");
  const scrollback = el("div", "loominate-drawer-content");
  drawer.append(summary, scrollback);
  main.append(passage, drawer);
  container.append(root);

  let reasons = 0;
  /**
   * Shows an error the story's code threw, at the top of the passage, where
   * it's announced, and passes it on. The next move clears it.
   */
  const failed = (error: unknown): void => {
    passage.querySelector(".loominate-error")?.remove();
    const p = el("p", "loominate-error");
    p.setAttribute("role", "alert");
    p.textContent = message("page.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    passage.prepend(p);
    console.error(error);
    options.onError?.(error);
  };
  /** Runs a step of play, showing what goes wrong instead of failing silently. */
  const guarded =
    <A extends unknown[]>(step: (...args: A) => void) =>
    (...args: A): void => {
      try {
        step(...args);
      } catch (error) {
        failed(error);
      }
    };

  const follow = guarded((choice: Choice): void => {
    story.follow(choice);
    options.onMove?.(choice);
    draw(true);
    passage.focus({ preventScroll: true });
  });

  /** Things' menus, whose actions are moves like following a link. */
  const menus = createMenus({
    doc,
    act: guarded((call: ActionCall, label: string): void => {
      story.act(call);
      options.onMove?.({ type: "action", label });
      draw(true);
      passage.focus({ preventScroll: true });
    }),
  });

  /**
   * A button for a link or continue point. One that can't be followed is
   * marked `aria-disabled` rather than `disabled`, so it stays in the tab
   * order and a keyboard or screen-reader player still finds it and its reason.
   */
  const button = (
    node: RenderedLink | Extract<RenderedNode, { type: "continue" }>,
    label: Node[] | string,
    className: string,
  ): HTMLElement => {
    const b = el("button", className);
    b.type = "button";
    b.append(...(typeof label === "string" ? [label] : label));
    if (node.type === "link" && !node.available) {
      b.setAttribute("aria-disabled", "true");
      return b;
    }
    // A thing's name opens its menu, instead of being followed.
    if (node.type === "link" && node.guard?.menu !== undefined) {
      const holder = el("span", "loominate-has-menu");
      holder.append(b);
      menus.trigger(b, node.guard.menu);
      return holder;
    }
    b.addEventListener("click", () => {
      follow(node);
    });
    return b;
  };

  /** A reason a link is disabled, linked to its button for screen readers. */
  const reason = (b: HTMLElement, text: string | undefined): HTMLElement | undefined => {
    if (text === undefined) return undefined;
    const r = el("span", "loominate-reason");
    r.id = `loominate-reason-${String(++reasons)}`;
    r.textContent = text;
    b.setAttribute("aria-describedby", r.id);
    return r;
  };
  const tooltips = (options.reasons ?? "tooltip") === "tooltip";
  /**
   * A disabled link with its reason as a tooltip: shown while the link is
   * hovered or focused, or after it's tapped, and hidden by Escape. The
   * reason stays in the page, so screen readers hear it as the description.
   */
  const withTooltip = (b: HTMLElement, r: HTMLElement): HTMLElement => {
    const holder = el("span", "loominate-has-reason");
    r.classList.add("loominate-tooltip");
    r.setAttribute("role", "tooltip");
    holder.append(b, r);
    b.addEventListener("click", () => {
      if (holder.hasAttribute("data-shown")) holder.removeAttribute("data-shown");
      else holder.setAttribute("data-shown", "");
      holder.removeAttribute("data-dismissed");
    });
    // Escape hides it until the pointer or focus leaves and comes back.
    const reset = (): void => {
      holder.removeAttribute("data-dismissed");
    };
    holder.addEventListener("pointerleave", reset);
    holder.addEventListener("focusout", reset);
    return holder;
  };
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
  root.ownerDocument.addEventListener("click", (event) => {
    const inside = (event.target as Element | null)?.closest(".loominate-has-reason");
    for (const h of root.querySelectorAll(".loominate-has-reason[data-shown]")) {
      if (h !== inside) h.removeAttribute("data-shown");
    }
  });

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

  /** Plays effects on their elements, or their reduced variants if the player prefers less motion. */
  const playEffects = (queue: readonly [EffectDefinition, NamedEffectNode, HTMLElement][]) => {
    if (queue.length === 0) return;
    const reduce =
      doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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

  // ---- Beats --------------------------------------------------------------

  /** The pending timed beat's timer, if one is running. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The controls for the pending beat: continue and skip. */
  let beatControls: HTMLElement | undefined;
  /** How many rendered nodes are on screen, so a beat's new part is appended after them. */
  let drawnCount = 0;

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const reducedMotion = (): boolean =>
    doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const immediate = (): boolean => options.pacing === "immediate" || reducedMotion();

  /** Moves past the pending beat, and shows the part it reveals. */
  const advance = guarded((): void => {
    const beat = story.render().beat;
    if (!beat) return;
    const focused = beatControls?.contains(doc.activeElement) ?? false;
    story.advance();
    options.onMove?.(beat);
    // A page break clears the screen; otherwise the new part follows what's shown.
    draw(true, beat.page ? 0 : drawnCount);
    if (focused) passage.focus({ preventScroll: true });
  });

  /** Moves past every remaining beat at once, without their effects. */
  const skip = guarded((): void => {
    const focused = beatControls?.contains(doc.activeElement) ?? false;
    let from = drawnCount;
    for (let beat = story.render().beat; beat; beat = story.render().beat) {
      story.advance();
      options.onMove?.(beat);
      if (beat.page) from = 0;
    }
    draw(false, from);
    if (focused) passage.focus({ preventScroll: true });
  });

  /** Shows the controls for a pending beat, and starts its timer when it's timed. */
  const drawBeat = (beat: BeatNode, arrived: boolean): void => {
    const timed = beat.duration !== undefined;
    if (timed && arrived && immediate()) {
      advance();
      return;
    }
    const controls = el("p", "loominate-beat");
    if (!timed || immediate()) {
      const next = el("button", "loominate-continue");
      next.type = "button";
      next.textContent = options.continueLabel ?? message("page.continue");
      next.addEventListener("click", advance);
      controls.append(next);
    }
    const skipping = el("button", "loominate-skip");
    skipping.type = "button";
    skipping.textContent = options.skipLabel ?? message("page.skip");
    skipping.addEventListener("click", skip);
    controls.append(" ", skipping);
    passage.append(controls);
    beatControls = controls;
    // Wall-clock time paces the presentation only; the story moves on through advance().
    if (timed && !immediate()) timer = setTimeout(advance, beat.duration);
  };

  // A click on the page, away from its buttons, hurries a timed pause along.
  root.addEventListener("click", (event) => {
    if (timer === undefined) return;
    if ((event.target as Element | null)?.closest("button, a, summary, input, select, textarea"))
      return;
    stopTimer();
    advance();
  });

  /**
   * Draws the passage, playing its effects if the player just arrived. With
   * `from`, keeps the first `from` nodes on screen and draws only the rest,
   * so a beat's new part is announced without repeating what came before.
   */
  const drawMain = (arrived: boolean, from = 0): void => {
    finishEffects();
    stopTimer();
    beatControls?.remove();
    beatControls = undefined;
    if (from === 0) passage.replaceChildren();
    const rendered = story.render();
    /** Effects waiting for the next element drawn. */
    let pending: [EffectDefinition, NamedEffectNode][] = [];
    const queue: [EffectDefinition, NamedEffectNode, HTMLElement][] = [];
    const drawn = (element: HTMLElement): void => {
      for (const [definition, node] of pending) queue.push([definition, node, element]);
      pending = [];
    };
    // What the player noticed goes where `{notices}` puts it, or else after the
    // passage's own text and before its choices: the text says what the player
    // did, the notices what came of it.
    const nodes = rendered.nodes.slice(from);
    const placed = nodes.some((n) => n.type === "notices");
    let noticesLeft = notices(from > 0);
    const drawNotices = (): void => {
      // Atmosphere from fuses and daemons runs together; what stands out has its own paragraph.
      for (const paragraph of _noticeParagraphs(noticesLeft)) {
        const p = el("p", "loominate-notice");
        paragraph.forEach((notice, i) => {
          if (i > 0) p.append(" ");
          appendProse(p, notice.text, notice.styles ?? [], [], () => el("span"));
        });
        passage.append(p);
        drawn(p);
      }
      noticesLeft = [];
    };
    for (const node of nodes) {
      if (
        node.type === "notices" ||
        (!placed && (node.type === "link" || node.type === "continue"))
      ) {
        drawNotices();
      }
      if (node.type === "notices") continue;
      if (node.type === "effect") {
        const definition = effect(node);
        if (definition.target === "page") queue.push([definition, node, root]);
        else pending.push([definition, node]);
      } else if (node.type === "text") {
        const p = el("p");
        const after: HTMLElement[] = [];
        appendProse(
          p,
          node.text,
          node.styles ?? [],
          node.links ?? [],
          (link: RenderedInlineLink, label) => {
            const b = button(link, label, "loominate-link loominate-inline");
            const r = reason(b, link.reason);
            if (r && tooltips) return withTooltip(b, r);
            if (r) after.push(r);
            return b;
          },
        );
        passage.append(p);
        drawn(p);
        // Reasons for disabled inline links follow the paragraph, so the sentence still reads.
        for (const r of after) {
          const note = el("p", "loominate-note");
          note.append(r);
          passage.append(note);
        }
      } else {
        const p = el("p", "loominate-choice");
        if (node.type === "continue") {
          p.append(
            button(
              node,
              node.label ?? options.continueLabel ?? message("page.continue"),
              "loominate-continue",
            ),
          );
        } else {
          const b = button(node, node.label, "loominate-link");
          const r = reason(b, node.reason);
          if (r && tooltips) p.append(withTooltip(b, r));
          else p.append(b, ...(r ? [" ", r] : []));
        }
        passage.append(p);
        drawn(p);
      }
    }
    drawNotices();
    drawnCount = rendered.nodes.length;
    if (arrived) playEffects(queue);
    if (rendered.beat) drawBeat(rendered.beat, arrived);
  };

  /**
   * The perception and action-result events of the move on screen: since it
   * began, or with `sinceBeat`, since the last beat moved past.
   */
  const notices = (sinceBeat: boolean): (RecordedEvent & ProseFields)[] => {
    const events = record.events({ kinds: [...NOTICE_KINDS, "navigation", "action", "beat"] });
    const out: (RecordedEvent & ProseFields)[] = [];
    for (const e of events) {
      const starts =
        (e.kind === "navigation" && e.redirected !== true) ||
        e.kind === "action" ||
        (e.kind === "beat" && (sinceBeat || e.page === true));
      if (starts) out.length = 0;
      // A redirect within the move isn't a notice; what came before it still is.
      else if (NOTICE_KINDS.includes(e.kind)) out.push(e as RecordedEvent & ProseFields);
    }
    return out;
  };

  const drawDrawer = (): void => {
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
      else if (e.kind !== "navigation" && e.kind !== "action" && e.kind !== "beat") {
        turns.at(-1)?.push(e);
      }
    }
    endPart();
    turns.pop();
    scrollback.replaceChildren(
      ...turns
        .filter((t) => t.length > 0)
        .map((turn) => {
          const section = el("section", "loominate-turn");
          for (const paragraph of _noticeParagraphs(turn)) {
            const p = el("p");
            paragraph.forEach((e, i) => {
              const fields = e as RecordedEvent & { text: string; styles?: readonly TextStyle[] };
              if (i > 0) p.append(" ");
              appendProse(p, fields.text, fields.styles ?? [], [], () => el("span"));
            });
            section.append(p);
          }
          return section;
        }),
    );
    drawer.hidden = scrollback.childElementCount === 0;
  };

  // ---- Layout and widgets ------------------------------------------------

  type Mounted = {
    readonly name: string;
    readonly element: HTMLElement;
    readonly definition: WidgetDefinition;
    readonly view: MountedWidget<unknown>;
    data: unknown;
  };
  let layout: { readonly name: string; readonly definition: LayoutDefinition } | undefined;
  let mounted: Mounted[] = [];
  const host: WidgetHost = {
    story,
    record,
    follow,
    menu: (anchor, thing) => {
      menus.trigger(anchor, thing);
    },
  };

  const mount = (region: HTMLElement, name: string): Mounted => {
    const definition = widgets.get(name);
    if (!definition) {
      throw new Error(
        `The widget "${name}" isn't registered. Register it with widgets.register("${name}", …).`,
      );
    }
    const element = el("div", `loominate-widget loominate-widget-${name}`);
    element.dataset.widget = name;
    region.append(element);
    const data = definition.data(game);
    return { name, element, definition, view: definition.view.mount(element, data, host), data };
  };
  const unmount = (w: Mounted): void => {
    w.view.unmount();
    w.element.remove();
  };

  /**
   * A region's element. Every widget sits in a landmark, so screen-reader
   * players can jump to it: `header`, `footer`, `nav`, and `aside` regions use
   * those elements, and any other region is a section named after itself.
   */
  const regionElement = (region: string): HTMLElement => {
    if (region === "main") return el("div");
    if (LANDMARKS.has(region)) return el(region as "header");
    const section = el("section");
    section.setAttribute("aria-label", regionLabel(region));
    return section;
  };

  // ---- Sidebars on narrow screens ---------------------------------------

  type Toggle = {
    readonly region: string;
    readonly button: HTMLElement;
    readonly panel: HTMLElement;
  };
  let toggles: Toggle[] = [];
  /** Which sidebars the player opened, kept across moves and layout switches. */
  const open = new Set<string>();
  const narrowQuery = doc.defaultView?.matchMedia?.(options.narrow ?? "(max-width: 48rem)");
  let panels = 0;

  /** Fills a sidebar region with its toggle and its panel, and returns the panel. */
  const sidebar = (region: HTMLElement, name: string): HTMLElement => {
    const button = el("button", "loominate-sidebar-toggle");
    button.type = "button";
    button.textContent = regionLabel(name);
    const panel = el("div", "loominate-sidebar-panel");
    panel.id = `loominate-sidebar-${String(++panels)}`;
    button.setAttribute("aria-controls", panel.id);
    button.addEventListener("click", () => {
      if (open.has(name)) open.delete(name);
      else open.add(name);
      applyNarrow();
    });
    region.append(button, panel);
    toggles.push({ region: name, button, panel });
    return panel;
  };

  /** Shows sidebars beside main on wide screens, and as closed-by-default drawers on narrow ones. */
  const applyNarrow = (): void => {
    const narrow = narrowQuery?.matches ?? false;
    root.toggleAttribute("data-narrow", narrow);
    for (const { region, button, panel } of toggles) {
      button.hidden = !narrow;
      const expanded = !narrow || open.has(region);
      button.setAttribute("aria-expanded", String(expanded));
      panel.hidden = !expanded;
    }
  };
  narrowQuery?.addEventListener("change", applyNarrow);

  /** Builds the regions of the layout `display.layout` names, if it changed. */
  const drawLayout = (): void => {
    const name = display.layout;
    const definition = layouts.get(name);
    if (layout?.name === name && layout.definition === definition) return;
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
    const sidebars = definition.sidebars ?? {};
    for (const [region, side] of Object.entries(sidebars)) {
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
    for (const w of mounted) unmount(w);
    mounted = [];
    toggles = [];
    const elements = new Map<string, HTMLElement>();
    for (const region of definition.regions) {
      const r = regionElement(region);
      r.className = `loominate-region loominate-region-${region}`;
      r.dataset.region = region;
      // A sidebar's widgets go in a panel that a button shows and hides on narrow screens.
      const side = sidebars[region];
      let into = r;
      if (side) {
        r.dataset.sidebar = side;
        into = sidebar(r, region);
      }
      if (region === "main") r.append(main);
      const names = definition.widgets?.[region] ?? [];
      for (const w of names) mounted.push(mount(into, w));
      r.hidden = region !== "main" && names.length === 0;
      elements.set(region, r);
    }
    // Main and its sidebars share a row of columns, in visual order, so
    // reading and tab order match what's on screen.
    const columns = el("div", "loominate-columns");
    const of = (s: "start" | "end") =>
      definition.regions
        .filter((r) => sidebars[r] === s)
        .map((r) => elements.get(r) as HTMLElement);
    columns.append(...of("start"), elements.get("main") as HTMLElement, ...of("end"));
    root.replaceChildren(
      ...definition.regions.flatMap((region) =>
        region === "main"
          ? [columns]
          : sidebars[region]
            ? []
            : [elements.get(region) as HTMLElement],
      ),
    );
    const sides = (["start", "end"] as const).filter((s) => of(s).some((r) => !r.hidden));
    if (sides.length > 0) root.dataset.sidebars = sides.join(" ");
    else delete root.dataset.sidebars;
    root.dataset.layout = name;
    layout = { name, definition };
    applyNarrow();
  };

  /** Updates each widget whose data changed, and remounts one whose definition was replaced. */
  const drawWidgets = (): void => {
    mounted = mounted.map((w) => {
      if (widgets.get(w.name) !== w.definition) {
        const region = w.element.parentElement;
        const next = region ? mount(region, w.name) : w;
        if (region) {
          w.element.replaceWith(next.element);
          w.view.unmount();
        }
        return next;
      }
      const data = w.definition.data(game);
      if (!same(data, w.data)) {
        w.view.update(data);
        w.data = data;
      }
      return w;
    });
  };

  const draw = (arrived = false, from = 0): void => {
    drawLayout();
    drawMain(arrived, from);
    drawDrawer();
    drawWidgets();
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
      narrowQuery?.removeEventListener("change", applyNarrow);
      for (const w of mounted) unmount(w);
      mounted = [];
      root.remove();
    },
  };
}

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
