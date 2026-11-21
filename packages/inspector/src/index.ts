/**
 * @packageDocumentation
 * The in-game inspector: a panel beside the game showing its state, with a
 * registry for panels from optional packages. `loominate dev` adds it to every
 * game; `loominate build --inspector` includes it in a build.
 */
export { inspect, type InspectOptions, type Inspector } from "./inspect.js";
export { panels, type InspectorPanel, type PanelContext, type PanelView } from "./panels.js";
export { choices } from "./choices.js";
export { eventLog } from "./event-log.js";
export { explainers, linkExplainer, type Explainer, type Explanation } from "./explainers.js";
export { history } from "./history.js";
export { replay } from "./replay.js";
export { rules } from "./rules.js";
export { stateTree } from "./state-tree.js";
