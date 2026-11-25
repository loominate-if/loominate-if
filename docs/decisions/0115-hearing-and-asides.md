# 0115. Who hears what, and asides

- **Status:** Accepted, 2026-11-25
- **Issue:** [#143](https://github.com/loominate-if/loominate-if/issues/143)
- **Design:** [Group conversations](../DESIGN.md#group-conversations), [ADR 0037](0037-perception.md)

## Context

The design has everyone present hear what's said and learn revealed facts, topics depend on who is present, `present(butler)`, and private asides limit who hears a line. Until now, an entry's `reveals` taught the player and the conversation's participants, and a block's `{reveal}` the player alone; a bystander in the room learned nothing.

## Decision

- **Everyone in earshot hears an answer:** what an entry's `reveals` or a block's `{reveal}` teaches, the player learns, and so does everyone else who can hear the speaker, by the world model's `canHear`, in the conversation or not, sourced to the speaker. A fact the player tells an NPC is learned by everyone who can hear the player, unless the answering entry says `informs: false`.
- **`present(x)`** is true while x is in the place the player is and can hear them, whether or not they're in the conversation. It's for a topic's `when`, `{ask letter, when: present(butler)}`, and any other condition.
- **Asides:** an entry's `aside: true`, or `aside` on a block, says the answer to the player alone. Nobody else learns what it reveals, it gets no reactions, and its line is tagged `aside`. The page marks it with its speaker, "Maid, aside: …", the `page.aside` message, whether it's speech or narration, so the player knows only they heard it.

## Consequences

- A bystander can learn what they overheard and use it later, in their own topics or agendas, and gossip (ADR 0110) can spread it.
- Hearing follows the world model's senses, so doors and rooms decide who overhears, not the conversation.
