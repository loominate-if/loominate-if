// No UI: the core runtime and story alone, to separate UI cost from runtime cost.
import { createGame } from "./game.ts";
(globalThis as { game?: unknown }).game = createGame();
