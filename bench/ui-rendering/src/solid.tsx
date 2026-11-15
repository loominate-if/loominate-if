import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { appRoot, createGame } from "./game.ts";

const game = createGame();

function App() {
  const [turn, setTurn] = createSignal(0);
  let main: HTMLElement | undefined;
  const act = (fn: () => void) => () => {
    fn();
    setTurn((t) => t + 1);
    main?.focus();
  };
  const page = () => (turn(), game.page());
  return (
    <>
      <header>
        <button type="button" disabled={(turn(), !game.canUndo())} onClick={act(game.undo)}>
          Undo
        </button>
      </header>
      <main ref={(el) => (main = el)} tabIndex={-1} aria-live="polite">
        <For each={page().nodes}>
          {(node) =>
            node.type === "text" ? (
              <p>{node.text}</p>
            ) : (
              <span>
                <button
                  type="button"
                  disabled={node.type === "link" && !node.available}
                  onClick={act(() => game.follow(node))}
                >
                  {node.type === "continue" ? (node.label ?? "Continue") : node.label}
                </button>
                <Show when={node.type === "link" && node.reason}>
                  <small>{node.type === "link" ? node.reason : ""}</small>
                </Show>
              </span>
            )
          }
        </For>
      </main>
      <details>
        <summary>Story so far</summary>
        <For each={(turn(), game.storySoFar())}>{(t) => <p>{t}</p>}</For>
      </details>
    </>
  );
}

render(() => <App />, appRoot());
