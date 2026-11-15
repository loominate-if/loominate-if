// Shared by every variant: a small branching story on the real core runtime.
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Choice,
  type Passage,
  type RenderedPassage,
} from "@loominate-if/core";

const passages: Passage[] = [
  {
    id: "Kitchen",
    tags: [],
    body: ({ firstVisit }) => [
      { type: "text", text: firstVisit ? "The kitchen is warm." : "Back in the kitchen." },
      { type: "link", label: "Take the lantern", target: "Lantern" },
      { type: "link", label: "Go to the cellar stairs", target: "Stairs" },
    ],
  },
  {
    id: "Lantern",
    tags: [],
    body: () => [
      { type: "text", text: "You take the lantern and light it." },
      { type: "continue", target: "Kitchen" },
    ],
    effects: { enter: ({ state }) => state.set("lantern", "lit", true) },
  },
  {
    id: "Stairs",
    tags: [],
    body: ({ state }) => [
      { type: "text", text: "The steps go down further than they should." },
      {
        type: "link",
        label: "Go down",
        target: "Cellar",
        guard: {
          open: state.get("lantern", "lit") === true,
          condition: "lantern.isLit",
          mode: "disabled-with-reason",
          reason: "It's too dark to see the steps.",
        },
      },
      { type: "link", label: "Back up", target: "Kitchen" },
    ],
  },
  { id: "Cellar", tags: [], body: () => [{ type: "text", text: "The end." }] },
];

export interface Game {
  page(): RenderedPassage;
  storySoFar(): string[];
  canUndo(): boolean;
  follow(choice: Choice): void;
  undo(): void;
}

export function createGame(): Game {
  const store = createStore();
  const record = createEventRecord(store);
  const history = createHistory(store);
  const story = createStory(store, record, passages, { start: "Kitchen" });
  story.begin();
  history.checkpoint("begin");
  return {
    page: () => story.render(),
    storySoFar: () => record.events({ kinds: ["narrative"] }).map((e) => e.text),
    canUndo: () => history.canUndo,
    follow(choice) {
      story.follow(choice);
      history.checkpoint(choice.target);
    },
    undo: () => void history.undo(),
  };
}

/** The element each variant renders into. */
export function appRoot(): HTMLElement {
  const root = document.getElementById("app");
  if (!root) throw new Error('expected an element with id "app"');
  return root;
}
