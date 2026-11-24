/**
 * Conversation widgets (#118, ADR 0095): a cast of portraits, one per
 * character in the conversation, the one addressed marked; and a list of
 * buttons, each taking an action, for the topics on offer. They're generic:
 * a package that knows the conversation, such as the world model, supplies
 * plain data and says how to act, so a game can replace either view.
 */
import { componentView } from "./view.js";
import { widget, type WidgetDefinition, type WidgetHost } from "./layout.js";
import type { PageGame } from "./page.js";

/** One character in a cast. */
export type CastMember = {
  /** Their ID, which addressing them is given. */
  readonly id: string;
  /** Their name, as shown and read: "the butler". */
  readonly name: string;
  /** Their portrait's image for their expression now, if they have one. */
  readonly image?: string;
  /** Their expression, as named, if they have one: "stern". */
  readonly expression?: string;
  /** What's shown with no image: their initials. */
  readonly initials: string;
  /** Whether the player is talking to them. */
  readonly addressed: boolean;
};

/** The data a cast shows. */
export type CastData = {
  /** What the cast is, for screen readers: "In the conversation". */
  readonly label: string;
  /** The characters, in order. */
  readonly members: readonly CastMember[];
};

/** How {@link castWidget} finds the cast and addresses one of them. */
export type CastOptions = {
  /** What the cast is called, for screen readers. */
  readonly label: (game: PageGame) => string;
  /** The characters in the conversation now. */
  readonly members: (game: PageGame) => readonly CastMember[];
  /** Turns to the character with ID `id`, as a move, through the page. */
  readonly address: (host: WidgetHost, id: string) => void;
};

/**
 * A cast of portraits: a button for each character, pressed for the one
 * addressed; choosing another addresses them. A portrait is the image for
 * their expression, or their initials.
 */
export function castWidget(options: CastOptions): WidgetDefinition<CastData> {
  return widget({
    data: (game) => ({ label: options.label(game), members: options.members(game) }),
    view: componentView<CastData>(({ data, host }) => {
      const d = data.value;
      if (d.members.length === 0) return null;
      return (
        <ul className="loominate-cast" aria-label={d.label}>
          {d.members.map((m) => {
            const name = m.expression === undefined ? m.name : `${m.name}, ${m.expression}`;
            return (
              <li key={m.id} className="loominate-cast-member" data-id={m.id}>
                <button
                  type="button"
                  className="loominate-portrait"
                  aria-pressed={m.addressed ? "true" : "false"}
                  {...(m.expression !== undefined && { "data-expression": m.expression })}
                  onClick={() => {
                    if (!m.addressed) options.address(host, m.id);
                  }}
                >
                  {m.image !== undefined ? (
                    <img className="loominate-portrait-image" src={m.image} alt="" />
                  ) : (
                    <span className="loominate-portrait-initials" aria-hidden="true">
                      {m.initials}
                    </span>
                  )}
                  <span className="loominate-portrait-name">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }),
  });
}

/** One button in an action list. */
export type ActionListItem = {
  /** What it says: "Ask about the letter". */
  readonly label: string;
  /** Whether it can be taken now. */
  readonly available: boolean;
  /** Why it can't, if it can't. */
  readonly reason?: string;
};

/** The data an action list shows. */
export type ActionListData = {
  /** What the list is, for screen readers: "Topics". */
  readonly label: string;
  /** Its buttons, in order. */
  readonly items: readonly ActionListItem[];
};

/** How {@link actionListWidget} finds its items and takes one. */
export type ActionListOptions = {
  /** What the list is called, for screen readers. */
  readonly label: (game: PageGame) => string;
  /** The items on offer now. */
  readonly items: (game: PageGame) => readonly ActionListItem[];
  /** Takes the item at `index`, as a move, through the page. */
  readonly take: (host: WidgetHost, index: number) => void;
};

/**
 * A list of buttons, each taking an action, as a conversation's topics. One
 * that can't be taken is shown disabled, with why.
 */
export function actionListWidget(options: ActionListOptions): WidgetDefinition<ActionListData> {
  const made = widget({
    data: (game) => ({ label: options.label(game), items: options.items(game) }),
    view: componentView<ActionListData>(({ data, host }) => {
      const d = data.value;
      if (d.items.length === 0) return null;
      return (
        <ul className="loominate-action-list" aria-label={d.label}>
          {d.items.map((item, i) => (
            <li key={`${String(i)}:${item.label}`}>
              {item.available ? (
                <button
                  type="button"
                  className="loominate-action-list-item"
                  onClick={() => {
                    options.take(host, i);
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="loominate-action-list-item"
                    aria-disabled="true"
                    {...(item.reason !== undefined && {
                      "aria-describedby": `loominate-action-why-${String(i)}`,
                    })}
                  >
                    {item.label}
                  </button>
                  {item.reason !== undefined && (
                    <span id={`loominate-action-why-${String(i)}`} className="loominate-action-why">
                      {item.reason}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      );
    }),
  });
  actionLists.set(made as WidgetDefinition<unknown>, options);
  return made;
}

/** The options each action list was made with, for testing. */
const actionLists = new WeakMap<WidgetDefinition<unknown>, ActionListOptions>();

/**
 * The options an action list widget was made with, if `definition` is one,
 * so walkthrough tests can take its items as the page does. @internal
 */
export function _actionListOf(
  definition: WidgetDefinition<unknown>,
): ActionListOptions | undefined {
  return actionLists.get(definition);
}
