import { appRoot, createGame } from "./game.ts";

const game = createGame();
const root = appRoot();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render(): void {
  const page = game.page();
  const main = el("main", { tabIndex: -1 });
  main.setAttribute("aria-live", "polite");
  for (const node of page.nodes) {
    if (node.type === "text") {
      main.append(el("p", {}, node.text));
    } else {
      const label = node.type === "continue" ? (node.label ?? "Continue") : node.label;
      const button = el(
        "button",
        { type: "button", disabled: node.type === "link" && !node.available },
        label,
      );
      button.addEventListener("click", () => {
        game.follow(node);
        render();
      });
      main.append(button);
      if (node.type === "link" && node.reason) main.append(el("small", {}, node.reason));
    }
  }
  const undo = el("button", { type: "button", disabled: !game.canUndo() }, "Undo");
  undo.addEventListener("click", () => {
    game.undo();
    render();
  });
  const drawer = el(
    "details",
    {},
    el("summary", {}, "Story so far"),
    ...game.storySoFar().map((t) => el("p", {}, t)),
  );
  root.replaceChildren(el("header", {}, undo), main, drawer);
  main.focus();
}

render();
