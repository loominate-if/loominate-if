/**
 * Presentation's views are Preact components (ADR 0079). A built-in
 * widget's view keeps its data in a signal, so when the page gives it new
 * data, only what reads that data redraws. The widget contract stays
 * framework-agnostic: this only adapts a component to it.
 */
import { signal, type Signal } from "@preact/signals";
import { options, render, type ComponentChildren, type ComponentType } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { MenuSource } from "./menus.js";
import type { WidgetHost, WidgetView } from "./layout.js";

/** What a widget's component is given: its data, as a signal, and the page it's on. @internal */
export type ViewProps<D> = { readonly data: Signal<D>; readonly host: WidgetHost };

/**
 * Runs `change`, redrawing what it changes before returning, so the page
 * and its tests see a widget's new state at once rather than on a later
 * tick. @internal
 */
export function now(change: () => void): void {
  const before = options.debounceRendering;
  options.debounceRendering = (run) => {
    run();
  };
  try {
    change();
  } finally {
    if (before) options.debounceRendering = before;
    else delete options.debounceRendering;
  }
}

/** A widget view drawn by a component, its data in a signal. @internal */
export function componentView<D>(Component: ComponentType<ViewProps<D>>): WidgetView<D> {
  return {
    mount(element, data, host) {
      const current = signal(data);
      render(<Component data={current} host={host} />, element);
      return {
        update(next) {
          now(() => {
            current.value = next;
          });
        },
        unmount() {
          render(null, element);
        },
      };
    },
  };
}

/** A button that opens a menu, as a thing's name does: registered with the page once, when it's drawn. @internal */
export function MenuButton(props: {
  readonly host: Pick<WidgetHost, "menu">;
  readonly source: MenuSource;
  readonly className?: string;
  readonly children: ComponentChildren;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // Once: a button's menu stays the same thing's, since buttons are keyed by what they open.
  useLayoutEffect(() => {
    if (button.current) props.host.menu(button.current, props.source);
  }, []);
  return (
    <button ref={button} type="button" className={props.className ?? "loominate-link"}>
      {props.children}
    </button>
  );
}
