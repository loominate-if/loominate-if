import { signal } from "@preact/signals";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { appRoot, createGame } from "./game.ts";

const game = createGame();
/** The move count, as a signal: components that read it redraw when it changes. */
const turn = signal(0);

function App() {
  void turn.value;
  const main = useRef<HTMLElement>(null);
  const act = (fn: () => void) => () => {
    fn();
    turn.value += 1;
  };
  const page = game.page();
  useEffect(() => main.current?.focus());
  return (
    <>
      <header>
        <button type="button" disabled={!game.canUndo()} onClick={act(game.undo)}>
          Undo
        </button>
      </header>
      <main ref={main} tabIndex={-1} aria-live="polite">
        {page.nodes.map((node, i) =>
          node.type === "text" ? (
            <p key={i}>{node.text}</p>
          ) : (
            <span key={i}>
              <button
                type="button"
                disabled={node.type === "link" && !node.available}
                onClick={act(() => game.follow(node))}
              >
                {node.type === "continue" ? (node.label ?? "Continue") : node.label}
              </button>
              {node.type === "link" && node.reason && <small>{node.reason}</small>}
            </span>
          ),
        )}
      </main>
      <details>
        <summary>Story so far</summary>
        {game.storySoFar().map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </details>
    </>
  );
}

render(<App />, appRoot());
