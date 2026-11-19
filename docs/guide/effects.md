# Effects

A passage can ask for a named effect, such as a fade, typewriter text, or a shake. Presentation plays it when the player arrives at the passage. [ADR 0020](../decisions/0020-named-effects.md) records the decisions behind this guide.

## In a passage

Put `{effect name}` on its own line, before what it should play on:

```
{effect shake}
The door bursts open.

{effect typewriter, duration: 2s}
"Who's there?" says a voice.

{effect fade}
[[Run -> Street]]
```

- `duration:` is how long the effect takes, such as `2s` or `300ms`. Each effect has its own default.
- `options:` passes further settings to effects that understand them: `{effect glow, options: { color: "gold" }}`.
- An effect plays on the next paragraph, link, or continue point. A page effect, such as `shake`, plays on the whole page.

## Built-in effects

| Effect | Plays on | Default duration | Does |
| --- | --- | --- | --- |
| `fade` | what follows | 600ms | Fades it in. |
| `typewriter` | what follows | 30ms a character | Reveals it a character at a time. |
| `shake` | the page | 400ms | Shakes the page from side to side. |

## What players get

- Effects play when the player arrives at a passage. Undo and loading a save show the passage without them.
- A click or key press finishes every effect that's still playing.
- When the player's system asks for reduced motion, the built-in effects don't play, and the text appears at once.
- Screen readers announce the passage's text whole and at once, including text that's being typed out.

## Registering your own

Register an effect in your game's code, under a one-word name, and use it with `{effect name}`:

```ts
import { effects } from "@loominate-if/presentation";

effects.register("glow", {
  play(element, { duration = 800, options }) {
    const color = typeof options.color === "string" ? options.color : "gold";
    const glow = element.animate(
      [{ textShadow: `0 0 0.5em ${color}` }, { textShadow: "none" }],
      { duration },
    );
    return () => glow.finish();
  },
});
```

An effect definition has these parts:

- `play(element, context)` starts the effect. `context` has the passage's `duration` (in milliseconds, if it gave one), its `options` (or `{}`), and the `page` root element. Return a function that ends the effect at once in its finished state, if it takes time. The page calls it when the player clicks or presses a key, and before the next move, so it must be safe to call after the effect has already ended.
- `target` is `"next"` (the default) to play on what follows, or `"page"` to play on the page's root.
- `reduced(element, context)` is what to play instead when the player prefers reduced motion, such as a brief change of color in place of a shake. Without it, the effect doesn't play for those players. Leave it out unless the effect carries meaning the player would otherwise miss.

To change a built-in effect, replace it: `effects.replace("fade", { play: … })`.

Keep effects to presentation. They can't change the story, because a passage's state changes belong in `{on enter: …}` and the other effect phases.
