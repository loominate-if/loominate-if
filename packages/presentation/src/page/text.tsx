/**
 * A widget showing a line of text that the game changes, such as the time
 * (#84): the world model's clock is one. The package that knows the text
 * supplies it, and needs no DOM itself.
 */
import { widget, type WidgetDefinition } from "./layout.js";
import { componentView } from "./view.js";

/** How {@link textWidget} shows its text. */
export type TextWidgetOptions = {
  /** The text to show now, such as "9:45 pm". */
  readonly text: () => string;
  /** What it is, for screen readers, such as "Time". */
  readonly label: () => string;
  /** A class for themes to style it by, as well as `loominate-text-widget`. */
  readonly className?: string;
};

/**
 * A widget showing a line of text, labelled for screen readers. It isn't a
 * live region: it changes as the game does, and the passage's text says
 * what happened.
 *
 * @example
 * ```ts
 * widgets.register("score", textWidget({ text: () => String(score.points), label: () => "Score" }));
 * addToHeader("score");
 * ```
 */
export function textWidget(options: TextWidgetOptions): WidgetDefinition<{
  readonly text: string;
  readonly label: string;
}> {
  return widget({
    data: () => ({ text: options.text(), label: options.label() }),
    view: componentView<{ readonly text: string; readonly label: string }>(({ data }) => (
      <div
        className={["loominate-text-widget", options.className].filter(Boolean).join(" ")}
        role="group"
        aria-label={data.value.label}
      >
        {data.value.text}
      </div>
    )),
  });
}
