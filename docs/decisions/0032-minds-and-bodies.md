# 0032. Minds, bodies, actors, and the player

- **Status:** Accepted, 2026-11-21
- **Issue:** [#65](https://github.com/loominate-if/loominate-if/issues/65)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0031](0031-containment-and-scope.md)

## Context

The design makes an actor two linked objects: a mind, with knowledge, traits, and conversation, and a body, with location, inventory, and senses. A mind inhabits a body, and that link is ordinary state. The player controls one mind and is otherwise not special. Possession, body swaps, empty bodies, and passenger minds all follow from the link. `actor(...)` hides the split for games that never use it. Rooms (#63) were waiting on knowing where the player is.

## Decision

### Bodies and minds

- `body(id, definition)` is a thing (ADR 0031) that holds things in it, its inventory. Scope, light, and `move` work on it as on any thing.
- `mind(id, definition)` is an object (ADR 0006). Its link to a body is state on the mind: `inhabits`, the body it's in or `null`, and `isPassenger`, whether it's there without control. A mind's definition can start it in a body.
- A body's controlling mind and its passengers are computed from the minds, the way contents are computed from locations (ADR 0031): `mindOf(body)` and `passengersOf(body)`, sorted by ID. A body never has two minds in control, since changes go through the functions below, and two definitions that start in control of one body are an error.
- An empty body has no mind in control. What it does on its own, such as an instinct behavior, comes with NPCs.

### Actors

- `actor(id, { body: {...}, mind: {...} })` defines a body and a mind that starts in it. The two halves are written as separate sections, so which half holds a property is always visible. Stats that declare themselves physical or mental come later (#92).
- The actor *is* its body, with ID `id`, since the body is what's moved, seen, and referred to (`location: mira`). Its mind's ID is `id:mind`.
- The actor reads and writes its mind's properties through, so `mira.courage` is the mind's though `mira` is the body. `mira.mind` and `mira.body` are the halves. A key in both halves is a type error and a runtime error. The link is the actor's own: when another mind possesses the body, `mira.courage` is still Mira's.
- Functions that take a mind accept an actor, meaning its mind; functions that take a body accept an actor, meaning itself.

### Transfers

- `possess(mind, body)` takes control. The mind that was in control stays in the body as a passenger, so nothing is lost unless the author asks for it. The possessor records it in `displaced`, state on the possessor's mind.
- `{ displaced: "out" }` pushes the displaced mind out of any body, and `{ as: "passenger" }` rides along without control, leaving the body's mind in control.
- When the possessor leaves, with `leaveBody(mind)` or by possessing another body, the mind it displaced takes control again, if it's still a passenger there. That's what authors expect of possession ending. `leaveBody(mind, { restore: false })` leaves the body empty instead, with the displaced mind still a passenger, for a trance or a body held for later.
- Only the displaced mind takes control back. A passenger that rode along with `{ as: "passenger" }` never does, so riding along can't become a takeover by accident. Possessors stacked on one body unwind in order, since each records whom it displaced; one cast out passes its record to the mind that cast it out.
- `swapBodies(a, b)` exchanges two minds' places, control or passenger as each was, and their `displaced` records with them, since a record belongs to the place in the body.
- Each is one change for undo, saves, and replays.

### The player

- `startAs(mindOrActor)` in `story.ts` names the mind the player starts as. It's called once. `playAs(mind)` switches during play.
- The world keeps the player's mind as an object with ID `world:player`, so switching is state like any other. `playerMind()` and `playerBody()` answer for whoever the player is now; scope, light, and everything else take the body as an argument, so nothing special-cases the player.
- Asking for the player before `startAs` is an error saying to call it.

### Getters stay getters

`thing()`, `place()`, `body()`, and `mind()` add their defaults by copying property descriptors, not by spreading the definition. Spreading read each getter once and stored its value, which broke derived values on things and would have broken an actor's pass-through properties.

## Consequences

- Perceived identity, narration person (#66), and perception (#69) build on bodies and the minds in them. Actions (#76) record the acting mind and body.
- Visits (#200) and rooms (#63) can follow the player's mind and body.
- A mind's knowledge, traits, and relationships are ordinary properties for now; the knowledge system (#67) and stats (#92) give them structure.
- `world:player` is a reserved-looking ID, not a reserved one: a game that defines its own object with that ID gets the usual "ID taken" error.
